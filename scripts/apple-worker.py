#!/usr/bin/env python3
"""Mac worker: external storage only, native checks, optional verified private OTA."""
import argparse
import ctypes
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import signal
import subprocess
import sys
import time
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory', type=Path)
parser.add_argument('--publish', action='store_true')
parser.add_argument('--manual-tests', action='store_true')
parser.add_argument('--team', required=True)
parser.add_argument('--device', default='iPhone')
parser.add_argument('--build-number')
parser.add_argument('--resume', action='store_true')
parser.add_argument('--allow-provisioning-updates', action='store_true')
parser.add_argument('--provision-helper', type=Path)
args = parser.parse_args()
os.umask(0o077)
BASE = args.directory.resolve()
SOURCE = BASE / 'source'
REPORT = BASE / 'apple-result.json'
CLI = '/Applications/RoamRun.app/Contents/MacOS/RoamRun'
APP_ID = 'de.lupfa.dagobert'
result = {'scope': 'Apple SDK build; isolated native model and simulator UI; no real CloudKit convergence',
          'steps': [], 'simulators': [], 'checks': {}, 'failures': 1}
if args.resume:
    result = json.loads(REPORT.read_text())
environment = dict(os.environ)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def save(stage, **fields):
    result.update(stage=stage, **fields)
    temporary = REPORT.with_suffix('.next')
    temporary.write_text(json.dumps(result, indent=2) + '\n')
    temporary.replace(REPORT)
    print(stage, flush=True)


def run(command, name, timeout=120, cwd=SOURCE, check=True):
    log_path = BASE / (name + '.log')
    save(name)
    with log_path.open('w') as log:
        with subprocess.Popen([str(p) for p in command], cwd=cwd, env=environment,
                              stdout=log, stderr=subprocess.STDOUT, start_new_session=True) as child:
            try:
                code = child.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except PermissionError:
                    child.terminate()
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except PermissionError:
                        child.kill()
                    child.wait()
                code = 124
    result['steps'].append({'id': name, 'exit': code, 'log': str(log_path)})
    save(name)
    text = log_path.read_text(errors='replace')
    if check:
        require(code == 0, f'{name} failed (exit {code}); see {log_path}')
    return code, text


def json_run(command, name, timeout=120):
    return json.loads(run(command, name, timeout)[1])


def verify_sources():
    manifest = json.loads((BASE / 'source-manifest.json').read_text())
    for name, digest in manifest['files'].items():
        path = SOURCE / name
        require(path.resolve().is_relative_to(SOURCE), 'Source path escapes snapshot')
        if name.endswith('/swiftpm/Package.resolved'):
            continue  # SwiftPM generates the resolved revision; checked separately below.
        require(hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'Source changed: ' + name)
    result['source_manifest_sha256'] = hashlib.sha256((BASE / 'source-manifest.json').read_bytes()).hexdigest()


def keychain_unlocked():
    security = ctypes.CDLL('/System/Library/Frameworks/Security.framework/Security')
    security.SecKeychainOpen.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]
    security.SecKeychainGetStatus.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
    keychain = Path.home() / 'Library/Keychains/login.keychain-db'
    reference, flags = ctypes.c_void_p(), ctypes.c_uint32()
    require(security.SecKeychainOpen(os.fsencode(keychain), ctypes.byref(reference)) == 0, 'Login keychain unavailable')
    require(security.SecKeychainGetStatus(reference, ctypes.byref(flags)) == 0, 'Login keychain status unavailable')
    return bool(flags.value & 1)


def verify_ui_diagnostics(container, label):
    journal = Path(container) / 'Library/Caches/ui-diagnostics.jsonl'
    rows = [json.loads(line) for line in journal.read_text().splitlines()]
    (BASE / (label + '-ui-diagnostics.json')).write_text(json.dumps(rows, indent=2))
    security = [row for row in rows if row.get('kind') == 'security']
    for phase in ['cold-start', 'background']:
        states = [row for row in security if row['phase'] == phase]
        require(states and all(row['allowed'] is False and row['contentHidden'] is True for row in states),
                'Native data guard/privacy shield failed: ' + phase)
    require(any(row['phase'] == 'revealed' and row['allowed'] is True and row['contentHidden'] is False for row in security),
            'No authenticated native reveal was measured')
    stable = [row for row in rows if row.get('appUnlocked') and not row.get('contentHidden') and
              row.get('layout', {}).get('header') and row.get('layout', {}).get('dock') and
              abs(row['viewport']['visualHeight'] - row['viewport']['height']) < 1]
    require(len(stable) >= 2, 'Missing unlocked native layout measurements')
    for row in stable:
        native, layout, viewport = row['native'], row['layout'], row['viewport']
        require(abs(native['insetTop']) < 1 and abs(native['insetBottom']) < 1, 'UIKit added duplicate safe areas')
        require(abs(layout['header']['y']) < 1 and abs(layout['headerPadding'] - native['safeTop']) < 1,
                'Header does not own exactly one native top safe area')
        require(layout['header']['h'] <= native['safeTop'] + (74 if viewport['width'] >= 640 else 62),
                'Header exceeds the compact layout')
        if viewport['width'] < 640:
            require(abs(layout['dockPadding'] - native['safeBottom']) < 1 and layout['dockMargin'] == 0,
                    'Phone navigation safe area counted more than once')
            require(layout['dock']['h'] <= native['safeBottom'] + 60, 'Phone navigation has excess vertical space')
        else:
            require(layout['dockPadding'] == 6 and layout['dockMargin'] >= native['safeBottom'],
                    'Tablet navigation safe area counted more than once')
    result['checks'][label + '_single_app_lock'] = True
    result['checks'][label + '_safe_areas'] = True


def simulator_check(device_type, runtime, label, xcode):
    _, output = run(['xcrun', 'simctl', 'create', 'Dagobert-' + BASE.name + '-' + label, device_type, runtime], label + '-create')
    identifier = output.strip()
    require(re.fullmatch(r'[A-F0-9-]{36}', identifier), 'Unexpected simulator identifier')
    result['simulators'].append({'id': identifier, 'label': label, 'shutdown': False})
    logs = Path.home() / 'Library/Logs/CoreSimulator' / identifier
    destination = BASE / 'simulator-logs' / identifier
    destination.mkdir(parents=True)
    require(not logs.exists() and not logs.is_symlink(), 'New simulator log path already exists; no overwrite')
    logs.symlink_to(destination, target_is_directory=True)
    try:
        run(['xcrun', 'simctl', 'boot', identifier], label + '-boot')
        _, boot = run(['xcrun', 'simctl', 'bootstatus', identifier, '-b'], label + '-bootstatus', 180)
        require('Finished' in boot and 'Data Migration Failed' not in boot, 'Simulator boot not positively verified')
        bundle = BASE / (label + '.xcresult')
        run([*xcode, 'test-without-building', '-configuration', 'Debug', '-destination', 'platform=iOS Simulator,id=' + identifier,
             '-parallel-testing-enabled', 'NO', '-maximum-concurrent-test-simulator-destinations', '1',
             '-resultBundlePath', bundle, 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-',
             'DEVELOPMENT_TEAM=' + args.team], label + '-uitests', 600)
        summary = json_run(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary', '--path', bundle], label + '-summary')
        require(summary.get('passedTests') == 3 and summary.get('failedTests') == 0 and summary.get('skippedTests') == 0,
                'Expected exactly three passing, zero skipped UI tests')
        nodes = json_run(['xcrun', 'xcresulttool', 'get', 'test-results', 'tests', '--path', bundle], label + '-tests')
        serialized = json.dumps(nodes)
        for name in ['testNativeOfflineNavigation', 'testNativeBookingPersistsAcrossAppRestart', 'testNativeRelocksAndRejectsNonmatchingFace']:
            require(name in serialized, 'Missing UI test: ' + name)
        attachments = BASE / (label + '-attachments')
        run(['xcrun', 'xcresulttool', 'export', 'attachments', '--path', bundle, '--output-path', attachments], label + '-attachments')
        require(len(list(attachments.rglob('*.png'))) >= 4, 'Missing retained app screenshots')
        container = run(['xcrun', 'simctl', 'get_app_container', identifier, APP_ID, 'data'], label + '-diagnostic-container')[1].strip()
        verify_ui_diagnostics(container, label)
        result['checks'][label + '_native_ui'] = True
    finally:
        primary_error = sys.exc_info()[0] is not None
        try:
            container_code, container = run(['xcrun', 'simctl', 'get_app_container', identifier, APP_ID, 'data'],
                                             label + '-container', 30, check=False)
            if container_code == 0:
                diagnostics = Path(container.strip()) / 'Library/Caches/ui-diagnostics.jsonl'
                if diagnostics.is_file():
                    (BASE / (label + '-ui-diagnostics.json')).write_text(json.dumps([json.loads(line) for line in diagnostics.read_text().splitlines()], indent=2))
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            result['diagnostic_collection_error'] = str(error)
        code, _ = run(['xcrun', 'simctl', 'shutdown', identifier], label + '-shutdown', 60, check=False)
        result['simulators'][-1]['shutdown'] = code == 0
        if code and not primary_error:
            raise RuntimeError('Own simulator failed to shut down')


def publish(xcode):
    require(keychain_unlocked(), 'Login keychain locked; native unlock required')
    devices = json_run([CLI, 'devices', '--json'], 'roamrun-devices')
    matches = [d for d in devices if d.get('name') == args.device]
    require(len(matches) == 1 and matches[0].get('udid'), 'One confirmed RoamRun device required')
    udid = matches[0]['udid']
    archive = BASE / 'Dagobert.xcarchive'
    helper = args.provision_helper or SOURCE / 'scripts/apple-provision.py'
    require(helper.is_file(), 'Existing-account provisioning helper is required')
    profile_command = [sys.executable, helper, '--directory', BASE, '--team', args.team,
                       '--bundle', APP_ID, '--udid', udid, '--apply']
    if args.build_number:
        profile_command.extend(['--build-number', args.build_number])
    if args.resume and archive.is_dir():
        require(any(s['id'] == 'archive' and s['exit'] == 0 for s in result['steps']), 'Existing archive was not verified')
    else:
        run([*profile_command, '--archive'], 'archive', 960)
    run(profile_command, 'provision-profile', 240)
    chosen = json.loads((BASE / 'provisioning-proof.json').read_text())
    require(chosen['bundle'] == APP_ID and chosen['team'] == args.team and chosen['device_udid'] == udid,
            'Provisioning receipt scope mismatch')
    options = BASE / 'ExportOptions.plist'
    options.write_bytes(plistlib.dumps({'method': 'release-testing', 'destination': 'export', 'signingStyle': 'manual',
        'signingCertificate': chosen['certificate_sha1'], 'provisioningProfiles': {APP_ID: chosen['profile_uuid']},
        'teamID': args.team, 'stripSwiftSymbols': True, 'manageAppVersionAndBuildNumber': False}))
    export_path = BASE / ('export-' + str(time.time_ns()) if args.resume else 'export')
    export_command = ['xcodebuild', '-exportArchive', '-archivePath', archive, '-exportPath', export_path,
                      '-exportOptionsPlist', options]
    run(export_command, 'export', 600)
    ipas = list(export_path.glob('*.ipa'))
    require(len(ipas) == 1, 'Expected one final IPA')
    ipa = ipas[0]
    with zipfile.ZipFile(ipa) as zipped:
        require(zipped.testzip() is None, 'IPA CRC failed')
        require(all(not Path(name).is_absolute() and '..' not in Path(name).parts for name in zipped.namelist()), 'Unsafe IPA path')
    verification = BASE / 'ipa-verification'
    run(['ditto', '-x', '-k', ipa, verification], 'extract-ipa')
    apps = list((verification / 'Payload').glob('*.app'))
    require(len(apps) == 1, 'Expected one app')
    app = apps[0]
    run(['codesign', '--verify', '--deep', '--strict', app], 'codesign')
    save('signed-entitlements')
    display = subprocess.run(['codesign', '-d', '--entitlements', ':-', str(app)], capture_output=True,
                             cwd=SOURCE, env=environment, timeout=60)
    (BASE / 'signed-entitlements.plist').write_bytes(display.stdout)
    (BASE / 'signed-entitlements.log').write_bytes(display.stderr)
    result['steps'].append({'id': 'signed-entitlements', 'exit': display.returncode, 'log': str(BASE / 'signed-entitlements.log')})
    require(display.returncode == 0, 'Cannot inspect actual signed app permissions')
    signed = plistlib.loads(display.stdout)
    require(signed.get('get-task-allow') is False and signed.get('application-identifier') == args.team + '.' + APP_ID and
            signed.get('com.apple.developer.team-identifier') == args.team, 'Actual signed app permissions/identity mismatch')
    require(signed.get('com.apple.developer.icloud-container-environment') == 'Production' and
            signed.get('aps-environment') == 'production', 'Actual app CloudKit/Push environment mismatch')
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    require(info['CFBundleIdentifier'] == APP_ID, 'Unexpected application identity')
    if args.build_number:
        require(str(info['CFBundleVersion']) == args.build_number, 'Archive did not use the requested build number')
    _, cms = run(['security', 'cms', '-D', '-i', app / 'embedded.mobileprovision'], 'profile')
    profile = plistlib.loads(cms.encode())
    entitlements = profile['Entitlements']
    require(args.team in profile['TeamIdentifier'] and udid in profile.get('ProvisionedDevices', []), 'Profile does not cover team/device')
    require(profile['ExpirationDate'] > datetime.datetime.utcnow() and entitlements.get('get-task-allow') is False,
            'Invalid or non-Ad-Hoc profile')
    result.update(ipa=str(ipa), ipa_sha256=hashlib.sha256(ipa.read_bytes()).hexdigest(), ipa_bytes=ipa.stat().st_size,
                  bundle_id=info['CFBundleIdentifier'], version=info['CFBundleShortVersionString'], build=info['CFBundleVersion'], device_udid=udid)
    # Only this app's new OTA storage is redirected. Existing RoamRun builds/profiles stay untouched.
    ota = Path.home() / 'Library/Application Support/RoamRun/ota' / APP_ID
    storage = Path('/Volumes/Dev/Work/Dagobert/ota') / APP_ID
    storage.mkdir(parents=True, exist_ok=True)
    if not ota.exists() and not ota.is_symlink():
        ota.symlink_to(storage, target_is_directory=True)
    require(ota.resolve() == storage.resolve(), 'Dagobert OTA storage is not on the external disk')
    run(['open', '-gj', '-a', 'RoamRun'], 'open-roamrun')
    _, publication = run([CLI, 'ota', args.device, ipa], 'ota', 180)
    urls = re.findall(r'https://[^\s<>"\x1b]+', publication)
    require(urls, 'RoamRun did not return an HTTPS URL')
    result['url'] = urls[-1].rstrip('.,')
    result['checks']['signed_private_ota_stored'] = True


try:
    require(sys.platform == 'darwin' and BASE.is_relative_to(Path('/Volumes/Dev/Work/Dagobert')), 'External Mac run directory required')
    require(Path('/Volumes/Dev').is_mount(), 'External development disk is not mounted')
    require((Path.home() / 'Library/Developer/CoreSimulator').resolve().is_relative_to(Path('/Volumes/Dev')),
            'Simulator device storage must already point to the external disk; no automatic relocation')
    BASE.mkdir(parents=True, exist_ok=True)
    lock = (BASE.parent / 'apple.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    for name in ['tmp', 'package-cache', 'packages', 'module-cache', 'derived']:
        (BASE / name).mkdir(exist_ok=True)
    environment.update(TMPDIR=str(BASE / 'tmp') + '/', CLANG_MODULE_CACHE_PATH=str(BASE / 'module-cache'),
                       SWIFT_MODULECACHE_PATH=str(BASE / 'module-cache'), SWIFTPM_MODULECACHE_OVERRIDE=str(BASE / 'module-cache'))
    os.environ.update(environment)
    save('preflight', worker_pid=os.getpid())
    result['worker_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    if args.resume:
        require(result.get('source_manifest_sha256') == hashlib.sha256((BASE / 'source-manifest.json').read_bytes()).hexdigest(),
                'Resume source manifest differs from the verified build')
        result.pop('error', None)
    verify_sources()
    run(['xcodebuild', '-version'], 'toolchain')
    xcode = ['xcodebuild', '-project', SOURCE / 'ios/App/App.xcodeproj', '-scheme', 'App', '-jobs', '2',
             '-derivedDataPath', BASE / 'derived', '-clonedSourcePackagesDirPath', BASE / 'packages',
             '-packageCachePath', BASE / 'package-cache', '-disablePackageRepositoryCache', '-skipPackageUpdates',
             'CLANG_MODULE_CACHE_PATH=' + str(BASE / 'module-cache'), 'SWIFT_TREAT_WARNINGS_AS_ERRORS=YES']
    if not args.resume:
        run([*xcode, '-resolvePackageDependencies'], 'resolve', 600)
    resolved = json.loads((SOURCE / 'ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved').read_text())
    pin = [p for p in resolved['pins'] if p['identity'] == 'capacitor-swift-pm']
    require(len(pin) == 1 and pin[0]['location'] == 'https://github.com/hehljo/capacitor-swift-pm.git'
            and pin[0]['state']['version'] == '8.6.0' and pin[0]['state'].get('revision'), 'Unexpected dependency resolution')
    result['resolved_packages'] = resolved
    if args.manual_tests:
        require(args.publish, 'Manual-test mode is only for an authorized private build/export')
        result['scope'] = 'Private build/export; native UI and real-device acceptance remain with the user'
        result['manual_tests_pending'] = True
        verify_sources()
        result['checks']['source_snapshot_unchanged'] = True
        publish(xcode)
        save('passed', failures=0)
        sys.exit(0)
    if args.resume:
        require(any(s['id'] == 'simulator-build' and s['exit'] == 0 for s in result['steps']), 'Resume requires a verified existing build')
        require(result.get('native_model', {}).get('failures') == 0, 'Resume requires passing native model tests')
    else:
        run([*xcode, 'build-for-testing', '-configuration', 'Debug', '-destination', 'generic/platform=iOS Simulator',
             'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'DEVELOPMENT_TEAM=' + args.team], 'simulator-build', 900)
    core = BASE / 'native-store-tests'
    if not args.resume:
        run(['xcrun', 'swiftc', '-warnings-as-errors', '-module-cache-path', BASE / 'module-cache',
         SOURCE / 'ios/App/App/DagobertDatabase.swift', SOURCE / 'ios/App/App/DocumentInbox.swift',
         SOURCE / 'tests/portable/main.swift', '-o', core], 'model-compile', 180)
    model = BASE / 'model'
    if not args.resume:
        model.mkdir()
        (model / 'identity-vectors.json').write_bytes((SOURCE / 'tests/portable/identity-vectors.json').read_bytes())
        run([core, 'selftest', model], 'native-model')
    native = json.loads((model / 'native-result.json').read_text())
    require(native['checks'] > 0 and native['failures'] == 0 and all(native['cases'].values()), 'Native model report failed')
    result['native_model'] = native
    runtimes = json_run(['xcrun', 'simctl', 'list', 'runtimes', '--json'], 'runtimes')['runtimes']
    runtime_info = next(r for r in reversed(runtimes) if r.get('isAvailable') and '.iOS-' in r['identifier'])
    runtime = runtime_info['identifier']
    types = json_run(['xcrun', 'simctl', 'list', 'devicetypes', '--json'], 'device-types')['devicetypes']
    phone = next(d['identifier'] for d in types if d['name'] == 'iPhone 17 Pro')
    supported = runtime_info.get('supportedDeviceTypes', [])
    tablet = next(d['identifier'] for d in supported if d.get('productFamily') == 'iPad' and '11-inch' in d['name'])
    for device_type, label in [(phone, 'iphone'), (tablet, 'ipad')]:
        if args.resume and result['checks'].get(label + '_native_ui'):
            summary = json_run(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary', '--path', BASE / (label + '.xcresult')], label + '-resume-summary')
            require(summary.get('passedTests') == 3 and summary.get('failedTests') == 0 and summary.get('skippedTests') == 0,
                    'Existing UI proof is not green')
        else:
            simulator_check(device_type, runtime, label, xcode)
    verify_sources()
    result['checks']['source_snapshot_unchanged'] = True
    if args.publish:
        publish(xcode)
    save('passed', failures=0)
except Exception as error:
    save('failed', error=str(error))
    print(str(error), file=sys.stderr, flush=True)
    sys.exit(1)
