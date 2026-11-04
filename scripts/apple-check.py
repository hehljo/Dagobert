#!/usr/bin/env python3
"""Prepare a verified external Mac snapshot, run the worker, and close only its Terminal tab."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tarfile
import time
import plistlib
import re
import ssl
import urllib.request
import urllib.parse
import zipfile
import io
from html.parser import HTMLParser
import uuid

ROOT = Path(__file__).resolve().parents[1]
PROFILE = json.loads(Path('/root/.config/app-pruefstand/hosts.json').read_text())['hosts']['mac-test']
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=12',
       '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
       '-o', 'UserKnownHostsFile=' + PROFILE['known_hosts'], PROFILE['host']]
SCP = ['scp', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=12',
       '-o', 'UserKnownHostsFile=' + PROFILE['known_hosts']]
DETAIL_STAGES = {'iphone-uitests', 'ipad-uitests', 'iphone-create', 'ipad-create', 'iphone-bootstatus',
                 'ipad-bootstatus', 'archive', 'export', 'ota', 'simulator-build', 'provision-profile'}


def remote(command, content=None, timeout=60):
    output = subprocess.run([*SSH, command], input=content, capture_output=True, text=True, timeout=timeout)
    if output.returncode:
        raise RuntimeError(output.stderr.strip() or output.stdout.strip())
    return output.stdout


def source_files():
    paths = []
    for base in ['ios/App', 'src', 'node_modules/@capacitor/share', 'node_modules/@capacitor/status-bar', 'tests/portable']:
        for path in (ROOT / base).rglob('*'):
            relative = path.relative_to(ROOT)
            if any(p in {'xcuserdata', 'build', '.build', 'DerivedData', '.DS_Store', '__pycache__'} for p in relative.parts):
                continue
            if path.is_file():
                if path.is_symlink() or path.name.startswith('.env') or path.suffix in {'.db', '.sqlite', '.sqlite3', '.p12', '.p8', '.mobileprovision', '.key', '.pem'}:
                    raise RuntimeError('Unexpected sensitive or linked file in native inputs: ' + str(relative))
                paths.append(path)
    paths += [ROOT / p for p in ['package.json', 'package-lock.json', 'capacitor.config.ts', 'ios/debug.xcconfig', 'scripts/apple-worker.py', 'scripts/apple-provision.py']]
    return sorted(set(paths))


def start(publish, prepared=False, manual_tests=False):
    from ruttla.contracts import ContractError, named_proof, validate_receipt
    name = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:8]
    local = ROOT / '.ruttla-evidence/apple' / name
    local.mkdir(parents=True)
    # The shipped web bundle (ios/App/App/public) is only current after cap:sync, so it always runs;
    # --prepared skips just the local gates. Skipping it shipped a stale UI in 1.0 (5).
    stages = [('cap-sync', ['npm', 'run', 'cap:sync'])]
    if not prepared and not manual_tests:
        stages.append(('local-gates', ['npm', 'run', 'gates']))
    for stage, command in stages:
        with (local / (stage + '.log')).open('w') as log:
            completed = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=1200)
        if completed.returncode:
            raise RuntimeError(stage + ' failed; see ' + str(local / (stage + '.log')))
    proof_status = {}
    proof_ids = ['portable-data', 'pin-api', 'browser-workflows', 'settings-workflows']
    for proof_id in proof_ids:
        try:
            validate_receipt(ROOT, named_proof(ROOT, proof_id))
            proof_status[proof_id] = 'current'
        except ContractError:
            # A private hand-test build keeps the storage proof mandatory. Stale
            # broader UI/API proofs remain explicitly pending, never green.
            if not manual_tests or proof_id == 'portable-data':
                raise
            proof_status[proof_id] = 'pending-user-acceptance; prior receipt not current'
    target = '/Volumes/Dev/Work/Dagobert/' + name
    files = source_files()
    manifest = {'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                'dirty_snapshot': True, 'files': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}
    manifest['local_proofs'] = {proof_id: hashlib.sha256((ROOT / '.ruttla-evidence' / (proof_id + '.json')).read_bytes()).hexdigest()
                               for proof_id in proof_ids}
    manifest['local_proof_status'] = proof_status
    app_id = re.search(r"appId:\s*['\"]([^'\"]+)", (ROOT / 'capacitor.config.ts').read_text()).group(1)
    published_builds = []
    for report_file in (ROOT / '.ruttla-evidence/apple').glob('*/apple-result.json'):
        previous = json.loads(report_file.read_text())
        if previous.get('bundle_id') == app_id and str(previous.get('build', '')).isdigit():
            published_builds.append(int(previous['build']))
    manifest['build_number'] = str(max(published_builds, default=0) + 1)
    # This exact synthetic vector fixture comes from the most recent successful portable run.
    proof = json.loads((ROOT / '.ruttla-evidence/portable-data.json').read_text())
    if proof.get('failures') != 0:
        raise RuntimeError('A successful portable receipt is required')
    vectors = sorted((ROOT / '.ruttla-evidence/portable').glob('*/identity-vectors.json'))[-1]
    manifest['files']['tests/portable/identity-vectors.json'] = hashlib.sha256(vectors.read_bytes()).hexdigest()
    (local / 'source-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    archive = local / 'source.tar'
    with tarfile.open(archive, 'w') as bundle:
        for path in files:
            bundle.add(path, arcname=str(path.relative_to(ROOT)), recursive=False)
        bundle.add(vectors, arcname='tests/portable/identity-vectors.json')
    plan = {'remote': target, 'local': str(local), 'publish_requested': publish, 'manual_tests': manual_tests, 'created': name, 'detached': True,
            'build_number': manifest['build_number'], 'local_proof_status': proof_status,
            'archive_sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}
    (local / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    setup = '''from pathlib import Path
import json,os
p=Path(%s)
assert Path('/Volumes/Dev').is_mount(), 'External Development volume is not mounted'
assert p.resolve().is_relative_to(Path('/Volumes/Dev/Work/Dagobert'))
p.mkdir(parents=True,exist_ok=False,mode=0o700)
print(str(p))
''' % repr(target)
    remote('python3 -', setup)
    for path in [archive, local / 'source-manifest.json']:
        subprocess.run([*SCP, str(path), PROFILE['host'] + ':' + target + '/' + path.name], check=True)
    prepare = '''from pathlib import Path
import hashlib,json,tarfile,os,subprocess,shlex
base=Path(%s); archive=base/'source.tar'
assert hashlib.sha256(archive.read_bytes()).hexdigest()==%s
source=base/'source';source.mkdir()
with tarfile.open(archive) as bundle:
 for item in bundle:
  assert item.isfile() and not item.issym() and not item.islnk() and (source/item.name).resolve().is_relative_to(source)
  bundle.extract(item,source)
manifest=json.loads((base/'source-manifest.json').read_text())
for name,digest in manifest['files'].items(): assert hashlib.sha256((source/name).read_bytes()).hexdigest()==digest,name
checkout=Path('/Volumes/Dev/Work/GitHub/Dagobert')
status=subprocess.check_output(['git','status','--short'],cwd=checkout,text=True)
settings=(checkout/'ios/App/App.xcodeproj/project.pbxproj').read_text()
import re
teams=set(re.findall(r'DEVELOPMENT_TEAM = ([A-Z0-9]+);',settings));assert len(teams)==1
team=teams.pop()
(base/'existing-checkout.json').write_text(json.dumps({'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=checkout,text=True).strip(),'status_preserved':status,'team':team},indent=2))
(base/'tmp').mkdir()
argv=['/usr/bin/python3',str(source/'scripts/apple-worker.py'),str(base),'--team',team]
argv.extend(['--build-number',manifest['build_number']])
if %s: argv.append('--publish')
if %s: argv.append('--manual-tests')
job=chr(10).join(['#!/bin/bash','export TMPDIR='+shlex.quote(str(base/'tmp')+'/'),shlex.join(argv)+' > '+shlex.quote(str(base/'worker.log'))+' 2>&1','worker_exit=$?','echo "$worker_exit" > '+shlex.quote(str(base/'worker.exit')),'exit "$worker_exit"',''])
(base/'job.command').write_text(job)
command=chr(10).join(['#!/bin/bash','nohup /bin/bash '+shlex.quote(str(base/'job.command'))+' </dev/null >'+shlex.quote(str(base/'task-shell.log'))+' 2>&1 &','job_pid=$!','echo "$job_pid" > '+shlex.quote(str(base/'detached-worker.pid')),'/usr/bin/caffeinate -i -w "$job_pid" </dev/null >'+shlex.quote(str(base/'caffeinate.log'))+' 2>&1 &','echo "$!" > '+shlex.quote(str(base/'caffeinate.pid')),''])
(base/'run.command').write_text(command)
(base/'run.command').chmod(0o700)
print(json.dumps({'files':len(manifest['files']),'team':team,'external':str(base)}))
''' % (repr(target), repr(plan['archive_sha256']), repr(publish), repr(manual_tests))
    print(remote('python3 -', prepare), end='')
    return launch(local)


def launch(local):
    plan = json.loads((local / 'plan.json').read_text())
    target, name = plan['remote'], plan['created']
    # Use the existing GUI Terminal session. Remember the exact tab/TTY we create.
    apple = '''tell application "Terminal"
set jobTab to do script %s
set custom title of jobTab to %s
set jobTTY to tty of jobTab
return jobTTY
end tell
''' % (json.dumps('/bin/bash ' + shlex.quote(target + '/run.command')), json.dumps('Dagobert-' + name))
    tty = remote('osascript -', apple).strip()
    plan['terminal_tty'] = tty
    (local / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    print('APPLE_RUN ' + str(local), flush=True)
    for attempt in range(10):
        try:
            cleanup(local)
            break
        except RuntimeError as error:
            if 'busy' not in str(error) and 'still running' not in str(error):
                raise
            time.sleep(1)
    return local


def resume(local, provision=False):
    plan = json.loads((local / 'plan.json').read_text())
    cleanup(local)
    manifest = json.loads((local / 'source-manifest.json').read_text())
    for name, digest in manifest['files'].items():
        if name in ['scripts/apple-worker.py', 'scripts/apple-provision.py', 'tests/portable/identity-vectors.json']:
            continue
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != digest:
            raise RuntimeError('Resume would change application/test sources: ' + name)
    suffix = uuid.uuid4().hex[:8]
    worker = plan['remote'] + '/apple-worker-resume-' + suffix + '.py'
    digest = hashlib.sha256((ROOT / 'scripts/apple-worker.py').read_bytes()).hexdigest()
    subprocess.run([*SCP, str(ROOT / 'scripts/apple-worker.py'), PROFILE['host'] + ':' + worker], check=True)
    helper = plan['remote'] + '/apple-provision-' + suffix + '.py'
    helper_hash = hashlib.sha256((ROOT / 'scripts/apple-provision.py').read_bytes()).hexdigest()
    subprocess.run([*SCP, str(ROOT / 'scripts/apple-provision.py'), PROFILE['host'] + ':' + helper], check=True)
    code = '''from pathlib import Path
import hashlib,json,shlex,shutil
base=Path(%r);worker=Path(%r)
assert (base/'worker.exit').exists(), 'Previous worker has no completion marker'
assert hashlib.sha256(worker.read_bytes()).hexdigest()==%r
helper=Path(%r)
assert hashlib.sha256(helper.read_bytes()).hexdigest()==%r
history=base/('resume-history-'+%r);history.mkdir()
for p in base.iterdir():
 if p.is_file() and p.suffix=='.pid':p.rename(history/p.name)
 elif p.is_file() and (p.suffix in ['.log','.json'] or p.name in ['run.command','job.command']):shutil.copy2(p,history/p.name)
(base/'worker.exit').rename(history/'worker.exit')
team=json.loads((base/'existing-checkout.json').read_text())['team']
argv=['/usr/bin/python3',str(worker),str(base),'--team',team,'--resume']
build_number=json.loads((base/'source-manifest.json').read_text()).get('build_number')
if build_number:argv.extend(['--build-number',build_number])
argv.extend(['--provision-helper',str(helper)])
if %r:argv.append('--publish')
if %r:argv.append('--allow-provisioning-updates')
if %r:argv.append('--manual-tests')
job=chr(10).join(['#!/bin/bash','export TMPDIR='+shlex.quote(str(base/'tmp')+'/'),shlex.join(argv)+' > '+shlex.quote(str(base/'worker.log'))+' 2>&1','worker_exit=$?','echo "$worker_exit" > '+shlex.quote(str(base/'worker.exit')),'exit "$worker_exit"',''])
(base/'job.command').write_text(job)
(base/'resume-manifest.json').write_text(json.dumps({'runner':str(worker),'sha256':%r,'application_manifest_unchanged':True,'history':str(history)},indent=2))
''' % (plan['remote'], worker, digest, helper, helper_hash, suffix, plan['publish_requested'], provision, plan.get('manual_tests', False), digest)
    remote('python3 -', code)
    plan.setdefault('resumes', []).append({'runner': worker, 'sha256': digest, 'provision_helper': helper, 'helper_sha256': helper_hash})
    (local / 'plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    current = local / 'apple-result.json'
    if current.exists():
        (local / ('resume-prior-' + suffix + '.json')).write_bytes(current.read_bytes())
    current.write_text(json.dumps({'stage': 'resume-starting', 'worker_exit': None}) + '\n')
    return launch(local)


def capabilities(local):
    plan = json.loads((local / 'plan.json').read_text())
    code = '''from pathlib import Path
import subprocess
base=Path(%r)
value=subprocess.run(['xcodebuild','-help'],capture_output=True,text=True,timeout=45)
help_text=value.stdout+value.stderr
(base/'xcode-cli-help.log').write_text(help_text)
print('\\n'.join(line for line in help_text.splitlines() if any(word in line.lower() for word in ['distributionlogs','logdirectory','provision','authentication','signingstyle','destination','exportpath'])))
home=Path.home()
old=home/'Library/Caches/DrinkAndHide/DH008-20261026-0635'
print('Existing signing helper directory:',old)
if old.exists():
 print('Helpers:',[p.name for p in old.iterdir() if p.suffix in ['.py','.command']])
for folder in [home/'.appstoreconnect/private_keys',home/'.private_keys',home/'.config/asc',home/'.config/appstoreconnect']:
 print('Credential location exists:',str(folder),folder.exists())
''' % plan['remote']
    print(remote('python3 -', code), flush=True)


def signing_info(local):
    code = '''from pathlib import Path
import ast,re
file=Path.home()/'Library/Caches/DrinkAndHide/DH008-20261026-0635/provision.py'
tree=ast.parse(file.read_text())
class Redact(ast.NodeTransformer):
 def visit_Constant(self,node):
  if isinstance(node.value,str):
   value=node.value
   if 'PRIVATE KEY' in value or len(value)>300 or re.fullmatch(r'[A-Z0-9]{10}',value) or re.fullmatch(r'[0-9a-fA-F-]{36}',value):return ast.copy_location(ast.Constant('<credential-or-metadata-redacted>'),node)
  return node
tree=Redact().visit(tree)
print(ast.unparse(tree))
'''
    print(remote('python3 -', code), flush=True)


def platform_info():
    code = '''import subprocess,shutil
for section in [None,'io','ui']:
 command=['xcrun','simctl','help']+([section] if section else [])
 result=subprocess.run(command,capture_output=True,text=True,timeout=30)
 print('SIMCTL',section or 'commands',result.stdout+result.stderr)
tool=shutil.which('applesimutils')
print('APPLESIMUTILS',tool)
if tool:print(subprocess.run([tool,'--help'],capture_output=True,text=True,timeout=30).stdout)
'''
    print(remote('python3 -', code, timeout=120), flush=True)


def profile_info(local):
    plan = json.loads((local / 'plan.json').read_text())
    code = '''from pathlib import Path
import json,plistlib,subprocess
base=Path(%r)
paths=list(base.glob('profile-*.mobileprovision'))+list((base/'Dagobert.xcarchive/Products/Applications').glob('*.app/embedded.mobileprovision'))
print('PROFILE_METADATA',flush=True)
for p in paths:
 raw=p.read_bytes();start=raw.index(b'<?xml');end=raw.index(b'</plist>',start)+len(b'</plist>')
 profile=plistlib.loads(raw[start:end]);ent=profile['Entitlements']
 print(json.dumps({'source':str(p),'team':profile['TeamIdentifier'],'expires':profile['ExpirationDate'].isoformat(),'entitlements':{k:v for k,v in ent.items() if k.startswith(('com.apple.developer.icloud','aps-environment','application-identifier','get-task-allow'))}},indent=2),flush=True)
print('original_checkout_entitlements',plistlib.loads(Path('/Volumes/Dev/Work/GitHub/Dagobert/ios/App/App/App.entitlements').read_bytes()))
''' % plan['remote']
    print(remote('python3 -', code), flush=True)


def artifact_audit(local):
    plan = json.loads((local / 'plan.json').read_text())
    code = '''from pathlib import Path
import hashlib,json,plistlib,subprocess
base=Path(%r);report=json.loads((base/'apple-result.json').read_text());team=json.loads((base/'existing-checkout.json').read_text())['team']
assert report['failures']==0 and hashlib.sha256(Path(report['ipa']).read_bytes()).hexdigest()==report['ipa_sha256']
apps=list((base/'ipa-verification/Payload').glob('*.app'));assert len(apps)==1
app=apps[0];info=plistlib.loads((app/'Info.plist').read_bytes())
value=subprocess.run(['codesign','-d','--entitlements',':-',str(app)],capture_output=True,check=True)
ent=plistlib.loads(value.stdout)
assert ent.get('get-task-allow') is False and ent.get('application-identifier')==team+'.'+report['bundle_id'] and ent.get('com.apple.developer.team-identifier')==team
assert ent.get('com.apple.developer.icloud-container-environment')=='Production' and ent.get('aps-environment')=='production'
assert 'iCloud.de.dagobert.app' in ent.get('com.apple.developer.icloud-container-identifiers',[]) and 'CloudKit' in ent.get('com.apple.developer.icloud-services',[])
binary=app/info['CFBundleExecutable']
architectures=subprocess.check_output(['lipo','-archs',str(binary)],text=True).split();assert architectures==['arm64']
assert b'dagobertUITest' not in binary.read_bytes(),'Debug diagnostics found in release executable'
proof={'ipa_sha256':report['ipa_sha256'],'signed_app_identity':ent['application-identifier'],'signed_get_task_allow':False,'cloudkit_environment':'Production','push_environment':'production','architectures':architectures,'debug_diagnostics_absent':True}
(base/'signature-proof.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof))
''' % plan['remote']
    print(remote('python3 -', code), flush=True)
    subprocess.run([*SCP, PROFILE['host'] + ':' + plan['remote'] + '/signature-proof.json', str(local / 'signature-proof.json')], check=True)
    from ruttla.contracts import named_proof, validate_receipt
    manifest = json.loads((local / 'source-manifest.json').read_text())
    checked = 0
    for name, digest in manifest['files'].items():
        if name == 'tests/portable/identity-vectors.json':
            candidates = (ROOT / '.ruttla-evidence/portable').glob('*/identity-vectors.json')
            matches = any(hashlib.sha256(path.read_bytes()).hexdigest() == digest for path in candidates)
        else:
            path = ROOT / name
            matches = path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == digest
        if not matches:
            raise RuntimeError('Published source no longer matches the local snapshot: ' + name)
        checked += 1
    for proof_id, digest in manifest['local_proofs'].items():
        proof = named_proof(ROOT, proof_id)
        validate_receipt(ROOT, proof)
        if hashlib.sha256((ROOT / proof['receipt']).read_bytes()).hexdigest() != digest:
            raise RuntimeError('Published proof receipt has changed: ' + proof_id)
    source_proof = {'snapshot_files_verified': checked, 'proof_receipts_current_and_unchanged': len(manifest['local_proofs']),
                    'build_number': manifest['build_number'], 'published_sources_match_local': True}
    (local / 'release-source-proof.json').write_text(json.dumps(source_proof, indent=2) + '\n')
    with (local / 'final-ruttla.log').open('w') as log:
        final = subprocess.run(['ruttla', '--changed-only', '--format', 'agent'], cwd=ROOT,
                               stdout=log, stderr=subprocess.STDOUT, timeout=300)
    if final.returncode:
        raise RuntimeError('Final Ruttla failed; see ' + str(local / 'final-ruttla.log'))
    print('APPLE_ARTIFACT_AUDIT ' + json.dumps(source_proof), flush=True)


def status(local, details=False):
    plan = json.loads((local / 'plan.json').read_text())
    script = '''from pathlib import Path
import json
p=Path(%s); report=p/'apple-result.json'
result=json.loads(report.read_text()) if report.exists() else {'stage':'starting'}
result['worker_exit']=int((p/'worker.exit').read_text()) if (p/'worker.exit').exists() else None
print(json.dumps(result))
''' % repr(plan['remote'])
    report = json.loads(remote('python3 -', script))
    test_stage = report.get('stage')
    if test_stage == 'failed':
        test_stage = next((step['id'] for step in reversed(report.get('steps', [])) if step.get('exit') and
                           step['id'] in DETAIL_STAGES), None)
    if details and test_stage in DETAIL_STAGES:
        log = plan['remote'] + '/' + test_stage + '.log'
        code = 'from pathlib import Path\nlines=Path(%r).read_text(errors="replace").splitlines()\nprint("\\n".join([line for line in lines[:-30] if "error:" in line]+lines[-30:]))\n' % log
        print(remote('python3 -', code), flush=True)
    (local / 'apple-result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'stage': report['stage'], 'exit': report['worker_exit'], 'error': report.get('error'),
                      'checks': report.get('checks'), 'url': report.get('url')}, ensure_ascii=False), flush=True)
    if report['worker_exit'] is not None:
        try:
            if report['worker_exit'] == 0 and report.get('url'):
                verify_ota(local)
        finally:
            cleanup(local)
            for name in ['worker.log', 'source-manifest.json']:
                subprocess.run([*SCP, PROFILE['host'] + ':' + plan['remote'] + '/' + name, str(local / name)], check=True)
    return report


def cleanup(local):
    plan = json.loads((local / 'plan.json').read_text())
    tty = plan.get('terminal_tty')
    if not tty:
        return
    marker = 'detached-worker.pid' if plan.get('detached') else 'worker.exit'
    remote('python3 -', 'from pathlib import Path\nassert (Path(' + repr(plan['remote']) + ')/' + repr(marker) + ').exists(), "Worker still running"\n')
    apple = '''tell application "Terminal"
repeat with jobWindow in windows
repeat with jobTab in tabs of jobWindow
if tty of jobTab is %s then
if busy of jobTab then error "Own Terminal tab still busy"
if (count of tabs of jobWindow) is not 1 then error "Own Terminal window has additional tabs; preserving them"
close jobWindow
return "closed-owned-tab"
end if
end repeat
end repeat
return "owned-tab-already-closed"
end tell
''' % json.dumps(tty)
    outcome = remote('osascript -', apple).strip()
    process_proof = None
    if (local / 'apple-result.json').exists() and json.loads((local / 'apple-result.json').read_text()).get('worker_exit') is not None:
        code = '''from pathlib import Path
import json,subprocess,os,signal
base=Path(%s);report=json.loads((base/'apple-result.json').read_text())
states=json.loads(subprocess.check_output(['xcrun','simctl','list','devices','--json'],text=True))
owned=[]
for device in report.get('simulators',[]):
 actual=next((d for values in states['devices'].values() for d in values if d['udid']==device['id']),None)
 assert actual is not None and actual['state']=='Shutdown','Own simulator still active'
 owned.append({'id':device['id'],'state':actual['state'],'dataPath':actual['dataPath']})
pidfile=base/'caffeinate.pid'
if pidfile.exists():
 pid=int(pidfile.read_text());ps=subprocess.run(['ps','-p',str(pid),'-o','command='],capture_output=True,text=True)
 if ps.returncode==0 and 'caffeinate -i -w '+(base/'detached-worker.pid').read_text().strip() in ps.stdout:os.kill(pid,signal.SIGTERM)
alive=subprocess.run(['ps','-p',str(report['worker_pid']),'-o','command='],capture_output=True,text=True)
assert not (alive.returncode==0 and str(base) in alive.stdout),'Own worker still active'
print(json.dumps({'simulators':owned,'worker_finished':True,'own_keep_awake_finished':True}))
''' % repr(plan['remote'])
        process_proof = json.loads(remote('python3 -', code))
        relocate_logs(local)
    (local / 'cleanup.json').write_text(json.dumps({'terminal': outcome, 'tty': tty, 'processes': process_proof, 'foreign_sessions': 'untouched'}, indent=2) + '\n')
    print('APPLE_CLEANUP ' + outcome, flush=True)


def relocate_logs(local):
    """Preserve this job's Xcode distribution logs on the external disk."""
    plan = json.loads((local / 'plan.json').read_text())
    code = '''from pathlib import Path
import hashlib,json,os,re,shutil
base=Path(%r)
assert (base/'worker.exit').exists(), 'Do not move logs of a running worker'
paths=set()
for log in list(base.glob('*.log'))+list(base.glob('resume-history-*/*.log')):
 paths.update(re.findall(r'Created bundle at path "([^"\\n]+\\.xcdistributionlogs)"',log.read_text(errors='replace')))
def hashes(folder):
 values={}
 for p in folder.rglob('*'):
  assert not p.is_symlink(),'Unexpected linked distribution log'
  if p.is_file():values[str(p.relative_to(folder))]=hashlib.sha256(p.read_bytes()).hexdigest()
 return values
moved=[]
for name in sorted(paths):
 source=Path(name)
 destination=base/'distribution-logs'/source.name
 if source.exists():
  assert source.resolve().is_relative_to(Path('/private/var/folders')) and source.name.startswith('App_')
  assert source.stat().st_uid==os.getuid() and not destination.exists(),'Preserve existing log destination'
  before=hashes(source);destination.parent.mkdir(exist_ok=True,mode=0o700)
  shutil.move(str(source),str(destination))
  assert hashes(destination)==before,'Distribution log move changed content'
 if destination.exists():moved.append({'source':name,'external':str(destination),'files':len(hashes(destination)),'preserved':True})
(base/'distribution-log-storage.json').write_text(json.dumps({'logs':moved,'external_only':True},indent=2))
print(json.dumps({'distribution_logs_preserved_external':len(moved)}))
''' % plan['remote']
    print(remote('python3 -', code), flush=True)
    subprocess.run([*SCP, PROFILE['host'] + ':' + plan['remote'] + '/distribution-log-storage.json', str(local / 'distribution-log-storage.json')], check=True)


def collect(local):
    local = local.resolve()
    plan = json.loads((local / 'plan.json').read_text())
    code = '''from pathlib import Path
import hashlib,json,subprocess,tarfile
base=Path(%s)
for bundle in base.glob('*.xcresult'):
 if not (bundle/'Info.plist').exists(): continue
 for section in ['summary','tests']:
  try:
   value=subprocess.run(['xcrun','xcresulttool','get','test-results',section,'--path',str(bundle)],capture_output=True,timeout=45)
   (base/(bundle.stem+'-diagnostic-'+section+'.json')).write_bytes(value.stdout)
  except subprocess.TimeoutExpired: pass
 attachments=base/(bundle.stem+'-attachments')
 if not attachments.exists():
  try: subprocess.run(['xcrun','xcresulttool','export','attachments','--path',str(bundle),'--output-path',str(attachments)],capture_output=True,timeout=90)
  except subprocess.TimeoutExpired: pass
archive=base/'evidence.tar.gz'
paths=[p for p in base.iterdir() if p.suffix in ['.log','.json','.xcresult'] or p.name.endswith('-attachments')]
with tarfile.open(archive,'w:gz') as tar:
 for path in paths: tar.add(path,arcname=path.name)
print(json.dumps({'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'bytes':archive.stat().st_size}))
''' % repr(plan['remote'])
    proof = json.loads(remote('python3 -', code, timeout=240))
    archive = local / 'evidence.tar.gz'
    subprocess.run([*SCP, PROFILE['host'] + ':' + plan['remote'] + '/evidence.tar.gz', str(archive)], check=True)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != proof['sha256']:
        raise RuntimeError('Evidence download hash mismatch')
    destination = local / ('evidence-' + uuid.uuid4().hex[:8]); destination.mkdir()
    with tarfile.open(archive) as bundle:
        for item in bundle:
            if item.issym() or item.islnk() or not (destination / item.name).resolve().is_relative_to(destination):
                raise RuntimeError('Unsafe evidence member')
            bundle.extract(item, destination, filter='data')
    (local / 'evidence-proof.json').write_text(json.dumps({**proof, 'directory': str(destination)}, indent=2) + '\n')
    render_frames(destination)
    print('APPLE_EVIDENCE ' + str(destination), flush=True)


def render_frames(destination):
    if not shutil.which('ffmpeg'):
        return
    for video in destination.rglob('*.mp4'):
        contact = video.with_suffix('.contact.png')
        if not contact.exists():
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(video),
                            '-vf', 'fps=1,scale=160:-1,tile=6x6', '-frames:v', '1', str(contact)],
                           capture_output=True, timeout=30, check=False)
        for second in [5, 15, 20, 25]:
            image = video.with_suffix('.frame-%s.png' % second)
            if image.exists():
                continue
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(video), '-ss', str(second),
                            '-frames:v', '1', str(image)], capture_output=True, timeout=30, check=False)


def recover(local):
    plan = json.loads((local / 'plan.json').read_text())
    code = '''from pathlib import Path
import json,subprocess,os,signal
base=Path(%s);report=json.loads((base/'apple-result.json').read_text())
ps=subprocess.check_output(['ps','-ww','-axo','pid,command'],text=True)
own=[]
for line in ps.splitlines()[1:]:
 parts=line.strip().split(None,1)
 if len(parts)!=2:continue
 pid,command=int(parts[0]),parts[1]
 if str(base) in command and 'apple-worker.py' in command: raise RuntimeError('Own worker is still running; do not recover')
 if str(base) in command and 'xcodebuild' in command:own.append(pid)
for pid in own:os.kill(pid,signal.SIGTERM)
cleanup=[]
for device in report.get('simulators',[]):
 state=json.loads(subprocess.check_output(['xcrun','simctl','list','devices','--json'],text=True))
 current=next((d for ds in state['devices'].values() for d in ds if d['udid']==device['id']),None)
 if not current or current['state']=='Shutdown':code=0
 else:code=subprocess.run(['xcrun','simctl','shutdown',device['id']],capture_output=True,timeout=60).returncode
 cleanup.append({'id':device['id'],'shutdown_exit':code})
 assert code==0,'Own simulator shutdown failed'
report.update(stage='interrupted',failures=1,error='Worker ended without completion marker; this run is not accepted',recovery=cleanup)
(base/'apple-result.json').write_text(json.dumps(report,indent=2)+'\\n')
(base/'worker.exit').write_text('1\\n')
print(json.dumps({'recovery':cleanup,'terminated_orphan_xcode_pids':own}))
''' % repr(plan['remote'])
    print(remote('python3 -', code, timeout=120), end='')
    cleanup(local)


def verify_ota(local):
    report = json.loads((local / 'apple-result.json').read_text())
    page = report['url']
    origin = urllib.parse.urlparse(page)
    if origin.scheme != 'https' or not origin.hostname.endswith('.ts.net'):
        raise RuntimeError('RoamRun did not return a private Tailnet HTTPS address')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    def fetch(url):
        parsed = urllib.parse.urlparse(url)
        if (parsed.scheme, parsed.hostname, parsed.port) != (origin.scheme, origin.hostname, origin.port):
            raise RuntimeError('OTA asset leaves the verified HTTPS origin')
        with opener.open(url, timeout=45) as response:
            if response.status != 200 or urllib.parse.urlparse(response.geturl()).netloc != origin.netloc:
                raise RuntimeError('Unexpected OTA HTTP response/redirect')
            return response.read(), response.headers.get_content_type()
    class Links(HTMLParser):
        def __init__(self):
            super().__init__(); self.manifests = []
        def handle_starttag(self, tag, attrs):
            href = dict(attrs).get('href', '')
            if tag == 'a' and href.startswith('itms-services:'):
                self.manifests += urllib.parse.parse_qs(urllib.parse.urlparse(href).query).get('url', [])
    html, mime = fetch(page)
    if mime != 'text/html':
        raise RuntimeError('OTA page is not HTML')
    (local / 'ota-page.html').write_bytes(html)
    links = Links(); links.feed(html.decode())
    matches = []
    for url in dict.fromkeys(links.manifests):
        payload, _ = fetch(url)
        manifest = plistlib.loads(payload)
        for item in manifest.get('items', []):
            meta = item.get('metadata', {})
            if meta.get('bundle-identifier') == report['bundle_id'] and str(meta.get('bundle-version')) == str(report['build']):
                matches.append((url, item, payload))
    if len(matches) != 1:
        raise RuntimeError('Expected exactly one matching Dagobert installation manifest')
    manifest_url, item, manifest_bytes = matches[0]
    packages = [asset['url'] for asset in item['assets'] if asset.get('kind') == 'software-package']
    if len(packages) != 1:
        raise RuntimeError('Expected one IPA asset')
    ipa, _ = fetch(packages[0])
    digest = hashlib.sha256(ipa).hexdigest()
    if digest != report['ipa_sha256'] or len(ipa) != report['ipa_bytes']:
        raise RuntimeError('Downloaded IPA differs from the signed Mac export')
    with zipfile.ZipFile(io.BytesIO(ipa)) as bundle:
        if bundle.testzip() is not None:
            raise RuntimeError('Downloaded IPA CRC failed')
        info_paths = [name for name in bundle.namelist() if name.startswith('Payload/') and name.count('/') == 2 and name.endswith('/Info.plist')]
        if len(info_paths) != 1:
            raise RuntimeError('Expected one application Info.plist')
        info = plistlib.loads(bundle.read(info_paths[0]))
        if (info['CFBundleIdentifier'], str(info['CFBundleVersion']), info['CFBundleShortVersionString']) != (report['bundle_id'], str(report['build']), report['version']):
            raise RuntimeError('Downloaded app identity/version mismatch')
    (local / 'Dagobert.ipa').write_bytes(ipa)
    (local / 'install-manifest.plist').write_bytes(manifest_bytes)
    (local / 'ota-http-proof.json').write_text(json.dumps({'page': page, 'manifest': manifest_url, 'ipa': packages[0],
        'sha256': digest, 'bytes': len(ipa), 'tls_verified': True, 'matches_signed_mac_export': True, 'device_installation': 'unmeasured'}, indent=2) + '\n')
    print('OTA_VERIFIED ' + page, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['run', 'resume', 'status', 'cleanup', 'collect', 'verify', 'recover', 'frames', 'capabilities', 'signing-info', 'profile-info', 'relocate-logs', 'artifact-audit', 'platform-info'])
    parser.add_argument('--directory', type=Path)
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--wait', action='store_true')
    parser.add_argument('--manual-tests', action='store_true', help='Build/export only; user performs native UI/device tests')
    parser.add_argument('--prepared', action='store_true', help='Skip local gates only when all source-bound receipts are current (cap:sync always runs)')
    parser.add_argument('--details', action='store_true', help='Show the current synthetic UI test log tail')
    parser.add_argument('--provision', action='store_true', help='Allow Xcode profile updates while resuming an authorized private export')
    args = parser.parse_args()
    if args.action not in ['run', 'platform-info'] and not args.directory:
        parser.error('--directory is required for status/cleanup')
    pipeline_lock = None
    if args.action in ['run', 'resume']:
        pipeline_lock = (ROOT / '.ruttla-evidence/apple-pipeline.lock').open('a')
        try:
            fcntl.flock(pipeline_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('An Apple pipeline is already running')
    local = start(args.publish, args.prepared, args.manual_tests) if args.action == 'run' else resume(args.directory, args.provision) if args.action == 'resume' else args.directory
    if args.action == 'platform-info':
        platform_info()
    elif args.action == 'artifact-audit':
        artifact_audit(local)
    elif args.action == 'relocate-logs':
        relocate_logs(local)
    elif args.action == 'profile-info':
        profile_info(local)
    elif args.action == 'signing-info':
        signing_info(local)
    elif args.action == 'capabilities':
        capabilities(local)
    elif args.action == 'frames':
        render_frames(local)
    elif args.action == 'recover':
        recover(local)
    elif args.action == 'verify':
        verify_ota(local)
    elif args.action == 'collect':
        collect(local)
    elif args.action == 'cleanup':
        cleanup(local)
    elif args.action == 'status' or args.wait:
        connection_errors = 0
        while True:
            try:
                report = status(local, args.details)
                connection_errors = 0
            except (RuntimeError, subprocess.TimeoutExpired) as error:
                if not args.wait or connection_errors >= 7 or not any(message in str(error) for message in ['timed out', 'Connection reset', 'Connection closed', 'Broken pipe']):
                    raise
                connection_errors += 1
                print('APPLE_CONNECTION waiting; existing worker is not restarted', flush=True)
                time.sleep(15)
                continue
            if report['worker_exit'] is not None:
                return report['worker_exit']
            if not args.wait:
                return 0
            time.sleep(15)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print('APPLE_ERROR ' + str(error), file=sys.stderr)
        sys.exit(1)
