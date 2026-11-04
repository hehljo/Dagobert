#!/usr/bin/env python3
"""Mac-only Ad-Hoc profile for an existing App ID, certificate and registered device.

Uses the existing protected Mac key without copying credentials or changing accounts.
Apple API: https://developer.apple.com/documentation/appstoreconnectapi/post-v1-profiles
"""
import argparse
import ast
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BUNDLE_ID = 'de.lupfa.dagobert'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def capabilities_cover_app(entitlements):
    """A profile grants permissions; its wildcard is not the app's literal value."""
    containers = entitlements.get('com.apple.developer.icloud-container-identifiers')
    services = entitlements.get('com.apple.developer.icloud-services')
    environment = entitlements.get('com.apple.developer.icloud-container-environment')
    return (isinstance(containers, list) and 'iCloud.de.dagobert.app' in containers and
            (services == '*' or isinstance(services, list) and ('CloudKit' in services or '*' in services)) and
            entitlements.get('aps-environment') == 'production' and
            (environment == 'Production' or isinstance(environment, list) and 'Production' in environment))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--team', required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--udid', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--archive', action='store_true', help='Archive with the existing Apple API key and Xcode automatic signing')
    parser.add_argument('--build-number')
    args = parser.parse_args()
    require(args.build_number is None or re.fullmatch(r'[1-9][0-9]{0,8}', args.build_number), 'Invalid build number')
    os.umask(0o077)
    base = args.directory.resolve()
    require(sys.platform == 'darwin' and base.is_relative_to(Path('/Volumes/Dev/Work/Dagobert')), 'External Mac directory required')
    require(args.bundle == BUNDLE_ID, 'Only the authorized Dagobert App ID is allowed')
    # Reuse the metadata reference from the proven Mac helper; do not execute its main/create flow.
    reference = Path.home() / 'Library/Caches/DrinkAndHide/DH008-20261026-0635/provision.py'
    tree = ast.parse(reference.read_text())
    entries = [node for node in tree.body if isinstance(node, ast.Assign) and
               any(isinstance(t, ast.Name) and t.id == 'config' for t in node.targets)]
    require(len(entries) == 1, 'Existing Apple account reference is ambiguous')
    config = ast.literal_eval(entries[0].value)
    require(set(config) == {'key_id', 'issuer_id'}, 'Unexpected Apple account metadata')
    key = Path.home() / '.private_keys' / ('AuthKey_' + config['key_id'] + '.p8')
    require(key.is_file() and key.stat().st_uid == os.getuid() and key.stat().st_mode & 0o077 == 0,
            'Existing Apple key must be owned by this user and protected')
    b64 = lambda value: base64.urlsafe_b64encode(value).rstrip(b'=')
    now = int(time.time())
    signing = b'.'.join([b64(json.dumps({'alg': 'ES256', 'kid': config['key_id'], 'typ': 'JWT'}).encode()),
                         b64(json.dumps({'iss': config['issuer_id'], 'iat': now, 'exp': now + 300, 'aud': 'appstoreconnect-v1'}).encode())])
    der = subprocess.run(['/usr/bin/openssl', 'dgst', '-sha256', '-sign', str(key)], input=signing,
                         capture_output=True, check=True, timeout=20).stdout
    require(der[0] == 48 and der[1] < 128, 'Unexpected ES256 signature encoding')
    position = 2
    values = []
    for _ in range(2):
        require(der[position] == 2, 'Invalid ES256 integer')
        size = der[position + 1]
        number = der[position + 2:position + 2 + size].lstrip(b'\0')
        require(len(number) <= 32, 'Invalid ES256 integer length')
        values.append(number.rjust(32, b'\0')); position += 2 + size
    require(position == len(der), 'Trailing ES256 signature data')
    token = (signing + b'.' + b64(b''.join(values))).decode()

    def api(path, body=None):
        require(path.startswith('/v1/'), 'Unexpected Apple API path')
        request = urllib.request.Request('https://api.appstoreconnect.apple.com' + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            details = json.loads(error.read()).get('errors', [])
            raise RuntimeError('Apple API HTTP %s: %s' % (error.code, json.dumps([
                {k: row.get(k) for k in ['code', 'title', 'detail']} for row in details]))) from None

    devices = api('/v1/devices?' + urllib.parse.urlencode({'filter[udid]': args.udid}))['data']
    require(len(devices) == 1 and devices[0]['attributes']['status'] == 'ENABLED' and
            devices[0]['attributes']['platform'] == 'IOS', 'Existing enabled iPhone required; no device registration performed')
    identities = subprocess.run(['security', 'find-identity', '-v', '-p', 'codesigning'],
                                capture_output=True, text=True, check=True, timeout=30).stdout
    fingerprints = set(re.findall(r'\b[A-F0-9]{40}\b', identities))
    certificates = api('/v1/certificates?limit=200')['data']
    matches = []
    for certificate in certificates:
        attributes = certificate['attributes']
        fingerprint = hashlib.sha1(base64.b64decode(attributes['certificateContent'])).hexdigest().upper()
        if attributes['certificateType'] in ['DISTRIBUTION', 'IOS_DISTRIBUTION'] and fingerprint in fingerprints:
            expiration = datetime.datetime.fromisoformat(attributes['expirationDate'].replace('Z', '+00:00'))
            if expiration > datetime.datetime.now(datetime.timezone.utc):
                matches.append((certificate, fingerprint))
    require(len(matches) == 1, 'One existing registered and locally usable Distribution certificate required; no certificate creation performed')
    certificate, fingerprint = matches[0]
    if args.archive:
        require(args.apply, 'Archive/signing updates require the explicit apply flag')
        existing = api('/v1/bundleIds?' + urllib.parse.urlencode({'filter[identifier]': 'de.dagobert.app'}))['data']
        require(len(existing) == 1 and existing[0]['attributes']['seedId'] == args.team,
                'Existing Dagobert account/team mismatch')
        source = base / 'source'
        command = ['xcodebuild', '-project', str(source / 'ios/App/App.xcodeproj'), '-scheme', 'App',
                   '-jobs', '2', '-derivedDataPath', str(base / 'derived'),
                   '-clonedSourcePackagesDirPath', str(base / 'packages'), '-packageCachePath', str(base / 'package-cache'),
                   '-disablePackageRepositoryCache', '-skipPackageUpdates',
                   '-allowProvisioningUpdates', '-authenticationKeyPath', str(key),
                   '-authenticationKeyID', config['key_id'], '-authenticationKeyIssuerID', config['issuer_id'],
                   'archive', '-configuration', 'Release', '-destination', 'generic/platform=iOS',
                   '-archivePath', str(base / 'Dagobert.xcarchive'), 'DEVELOPMENT_TEAM=' + args.team,
                   'CLANG_MODULE_CACHE_PATH=' + str(base / 'module-cache'), 'SWIFT_TREAT_WARNINGS_AS_ERRORS=YES']
        if args.build_number:
            command.append('CURRENT_PROJECT_VERSION=' + args.build_number)
        completed = subprocess.run(command, cwd=source, capture_output=True, text=True, timeout=900)
        output = completed.stdout + completed.stderr
        for value in [str(key), config['key_id'], config['issuer_id']]:
            output = output.replace(value, '<apple-auth-redacted>')
        print(output, flush=True)
        require(completed.returncode == 0, 'Xcode archive/signing failed')
        return 0
    bundles = api('/v1/bundleIds?' + urllib.parse.urlencode({'filter[identifier]': args.bundle}))['data']
    require(len(bundles) == 1 and bundles[0]['attributes']['identifier'] == args.bundle and
            bundles[0]['attributes']['seedId'] == args.team, 'Existing App ID/team mismatch; no registration performed')
    name = args.bundle + ' iPhone RoamRun AdHoc'
    profiles = api('/v1/profiles?' + urllib.parse.urlencode({'filter[name]': name}))['data']
    require(len(profiles) <= 1, 'Ambiguous Dagobert profile name')
    print(json.dumps({'preflight': 'passed', 'bundle': args.bundle, 'team': args.team,
                      'registered_device': True, 'existing_distribution_identity': True,
                      'matching_profiles': len(profiles)}, sort_keys=True), flush=True)
    if not args.apply:
        return 0
    created = not profiles
    if not profiles:
        profiles = [api('/v1/profiles', {'data': {'type': 'profiles',
            'attributes': {'name': name, 'profileType': 'IOS_APP_ADHOC'},
            'relationships': {'bundleId': {'data': {'type': 'bundleIds', 'id': bundles[0]['id']}},
                'certificates': {'data': [{'type': 'certificates', 'id': certificate['id']}]},
                'devices': {'data': [{'type': 'devices', 'id': devices[0]['id']}]}}}})['data']]
    profile = profiles[0]['attributes']
    require(profile['profileType'] == 'IOS_APP_ADHOC' and profile['profileState'] == 'ACTIVE', 'Ad-Hoc profile is not active')
    content = base64.b64decode(profile['profileContent'])
    downloaded = base / ('profile-' + profile['uuid'] + '.mobileprovision')
    if downloaded.exists():
        require(downloaded.read_bytes() == content, 'Existing downloaded profile differs; no overwrite')
    else:
        downloaded.write_bytes(content)
    decoded = subprocess.run(['security', 'cms', '-D', '-i', str(downloaded)], capture_output=True, check=True, timeout=30)
    document = plistlib.loads(decoded.stdout)
    entitlements = document['Entitlements']
    require(document['TeamIdentifier'] == [args.team] and document['ProvisionedDevices'] == [args.udid], 'Profile team/device coverage mismatch')
    require(entitlements['application-identifier'] == args.team + '.' + args.bundle and entitlements.get('get-task-allow') is False,
            'Profile identity/debug permission mismatch')
    require(document['ExpirationDate'] > datetime.datetime.utcnow(), 'Profile expired')
    require(fingerprint in [hashlib.sha1(value).hexdigest().upper() for value in document['DeveloperCertificates']], 'Profile does not cover the existing certificate')
    require(capabilities_cover_app(entitlements),
            'Existing CloudKit/Push capabilities are missing; no capability changes performed')
    parent = Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles'
    require(parent.resolve().is_relative_to(Path('/Volumes/Dev')), 'Xcode profile storage must be external')
    parent.mkdir(parents=True, exist_ok=True)
    installed = parent / (profile['uuid'] + '.mobileprovision')
    if installed.exists():
        require(installed.read_bytes() == content, 'Installed profile differs; no overwrite')
    else:
        installed.write_bytes(content)
    proof = {'bundle': args.bundle, 'team': args.team, 'device_udid': args.udid, 'profile_uuid': profile['uuid'],
        'profile_name': name, 'profile_path': str(installed), 'certificate_sha1': fingerprint, 'created': created,
        'expires': document['ExpirationDate'].isoformat(), 'get_task_allow': False, 'cloudkit_environment': entitlements.get('com.apple.developer.icloud-container-environment'),
        'source_reference_sha256': hashlib.sha256(reference.read_bytes()).hexdigest(), 'new_certificates': 0, 'new_devices': 0}
    (base / 'provisioning-proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    print('DAGOBERT_ADHOC_PROFILE_READY', flush=True)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print('PROVISION_ERROR ' + str(error), file=sys.stderr)
        sys.exit(1)
