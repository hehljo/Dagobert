"""One explicit local verification block; retains logs and synthetic data, no deployment."""
from datetime import datetime, timezone
from pathlib import Path
import argparse
import fcntl
import json
import os
import signal
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--suite', choices=['all', 'portable', 'imports', 'apple', 'comdirect', 'settings', 'browser', 'stale'], default='all')
    options = parser.parse_args()
    artifacts = ROOT / '.ruttla-evidence'
    artifacts.mkdir(exist_ok=True)
    with (artifacts / 'local-gates.lock').open('a') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('GATES_ERROR another verification block is running', file=sys.stderr)
            return 1
        run = artifacts / 'runs' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:8])
        run.mkdir(parents=True)
        environment = dict(os.environ, DAGOBERT_KEEP_TEST_DATA='1')
        commands = [
            ('inventory', ['ruttla', '--format', 'agent']),
            ('apple-provision', ['python3', 'scripts/test-apple-provision.py']),
            ('quality', ['npm', 'run', 'test:quality']),
            ('changed', ['ruttla', '--changed-only', '--format', 'agent']),
            ('final-inventory', ['ruttla', '--format', 'agent']),
        ]
        if options.suite == 'stale':
            from ruttla.contracts import ContractError, validate_receipt
            commands = []
            for proof in json.loads((ROOT / '.ruttla-contracts.json').read_text())['proofs']:
                try:
                    validate_receipt(ROOT, proof)
                except ContractError:
                    commands.append((proof['id'], ['python3', 'scripts/check-quality.py', '--proof', proof['id']]))
            commands.append(('changed', ['ruttla', '--changed-only', '--format', 'agent']))
        elif options.suite == 'browser':
            commands = [
                ('browser', ['python3', 'scripts/check-quality.py', '--proof', 'browser-workflows']),
                ('settings-browser', ['python3', 'scripts/check-quality.py', '--proof', 'settings-workflows']),
                ('changed', ['ruttla', '--changed-only', '--format', 'agent']),
                ('final-inventory', ['ruttla', '--format', 'agent']),
            ]
        elif options.suite == 'settings':
            commands = [
                ('build', ['npm', 'run', 'build']),
                ('definitions', ['node', 'node_modules/vitest/vitest.mjs', 'run', 'src/tests/rulesPackage.test.ts']),
                ('definitions-api', ['node', '--test', 'tests/rules-package.test.mjs', 'tests/bank-access-store.test.mjs', 'tests/comdirect-import.test.mjs']),
                ('native-store', ['python3', 'scripts/check-quality.py', '--proof', 'portable-data']),
                ('settings-browser', ['python3', 'scripts/check-quality.py', '--proof', 'settings-workflows']),
                ('changed', ['ruttla', '--changed-only', '--format', 'agent']),
            ]
        elif options.suite == 'comdirect':
            commands = [
                ('build', ['npm', 'run', 'build']),
                ('swift-version', ['swift', '--version']),
                ('swift-bank-typecheck', ['swiftc', '-warnings-as-errors', '-typecheck', 'ios/App/App/ComdirectSession.swift']),
                ('import-logic', ['node', 'node_modules/vitest/vitest.mjs', 'run', 'src/tests/bankImport.test.ts', 'src/tests/csvParser.test.ts']),
                ('import-api', ['node', '--test', 'tests/comdirect-import.test.mjs', 'tests/archive-import-validation.test.mjs']),
                ('native-store', ['python3', 'scripts/check-quality.py', '--proof', 'portable-data']),
            ]
        elif options.suite == 'portable':
            commands = [
                ('native-store', ['python3', 'scripts/check-quality.py', '--proof', 'portable-data']),
                ('changed', ['ruttla', '--changed-only', '--format', 'agent']),
                ('final-inventory', ['ruttla', '--format', 'agent']),
            ]
        elif options.suite != 'all':
            commands = [(options.suite, {'portable': ['python3', 'scripts/check-quality.py', '--proof', 'portable-data'],
                'imports': ['npm', 'run', 'test:ui', '--', '--imports-only'],
                'apple': ['python3', 'scripts/test-apple-provision.py']}[options.suite])]
        outcomes = []
        summary = {'scope': f'{options.suite}: local synthetic verification; Apple runtime unmeasured',
                   'status': 'running', 'outcomes': outcomes}
        def save(status, code=None):
            summary['status'] = status
            if code is not None:
                summary['exit'] = code
            (run / 'result.json').write_text(json.dumps(summary, indent=2))
        save('running')
        print(f'GATES_ARTIFACTS {run}', flush=True)
        for name, command in commands:
            with (run / f'{name}.log').open('w') as log:
                try:
                    with subprocess.Popen(command, cwd=ROOT, env=environment, stdout=log,
                                          stderr=subprocess.STDOUT, start_new_session=True) as process:
                        try:
                            code = process.wait(timeout=900)
                        except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
                            os.killpg(process.pid, signal.SIGTERM)
                            try:
                                process.wait(timeout=10)
                            except subprocess.TimeoutExpired:
                                os.killpg(process.pid, signal.SIGKILL)
                                process.wait()
                            code = 130 if isinstance(error, KeyboardInterrupt) else 124
                            log.write(f'\nGATE_STOPPED exit={code}\n')
                except OSError as error:
                    code = 127
                    log.write(f'GATE_START_ERROR {error}\n')
            outcomes.append({'id': name, 'command': command, 'exit': code, 'log': str(run / f'{name}.log')})
            save('running')
            print(f'GATE {name} exit={code} log={run / (name + ".log")}', flush=True)
            # Initial inventory may report missing/stale receipts; final inventory must be clean.
            if code and name != 'inventory':
                save('failed', code)
                print((run / f'{name}.log').read_text()[-12000:], file=sys.stderr)
                return code
        save('passed', 0)
        print(f'GATES_RESULT suite={options.suite} local=passed appleRuntime=unmeasured productionData=untouched', flush=True)
        return 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(f'GATES_ERROR {error}', file=sys.stderr)
        sys.exit(1)
