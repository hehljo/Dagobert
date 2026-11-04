"""Reproducible synthetic SQLite/backup checks; never signs, deploys, or opens production data."""
from pathlib import Path
from datetime import datetime, timezone
import json
import os
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]

def main():
    directory = ROOT / '.ruttla-evidence' / 'portable' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:8])
    directory.mkdir(parents=True)
    print(f'PORTABLE_ARTIFACTS {directory}', flush=True)
    environment = dict(os.environ, DAGOBERT_KEEP_TEST_DATA='1', DAGOBERT_PORTABLE_DIR=str(directory), DAGOBERT_NATIVE_RUNNER=str(directory / 'native-store-tests'))
    module = directory / 'SQLite3'
    module.mkdir()
    header = Path('/usr/include/sqlite3.h')
    arguments = []
    if sys.platform != 'darwin':
        if not header.exists():
            raise RuntimeError('sqlite3 development headers missing; native persistence is unmeasured')
        (module / 'module.modulemap').write_text(f'module SQLite3 [system] {{ header "{header}" link "sqlite3" export * }}\n')
        arguments = ['-I', str(module)]
    commands = [
        ['swift', '--version'],
        ['swiftc', '-warnings-as-errors', *arguments, str(ROOT / 'ios/App/App/DagobertDatabase.swift'), str(ROOT / 'ios/App/App/DocumentInbox.swift'), str(ROOT / 'tests/portable/main.swift'), '-o', environment['DAGOBERT_NATIVE_RUNNER']],
        ['swiftc', '-frontend', '-parse', *[str(p) for p in sorted((ROOT / 'ios/App/App').glob('*.swift'))]],
        ['node', '--test', 'tests/portable/contract.test.mjs'],
    ]
    for index, command in enumerate(commands):
        with (directory / f'{index + 1}.log').open('w') as log:
            result = subprocess.run(command, cwd=ROOT, env=environment, stdout=log, stderr=subprocess.STDOUT, timeout=180, check=False)
        if result.returncode:
            print((directory / f'{index + 1}.log').read_text(), file=sys.stderr)
            return result.returncode
    report = json.loads((directory / 'combined-result.json').read_text())
    if not report['checks'] or report['failures'] or not all(report['cases'].values()):
        raise RuntimeError('Missing or failing portable checks')
    output = os.environ.get('DAGOBERT_TEST_RESULT') or os.environ.get('PRUEF_RESULT')
    if output:
        Path(output).write_text(json.dumps(report))
    print(f"PORTABLE_RESULT checks={report['checks']} failures=0 appleRuntime=unmeasured", flush=True)
    return 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(f'PORTABLE_ERROR {error}', file=sys.stderr)
        sys.exit(1)
