"""Explicit test entry point; Ruttla scans receipts without launching tests."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from ruttla.contracts import (
    ContractError, local_path, named_proof, snapshot_inputs, validate_receipt, write_receipt,
)

ROOT = Path(__file__).resolve().parents[1]
COMMANDS = {
    "pin-api": ["npm", "test"],
    "browser-workflows": ["npm", "run", "test:ui"],
}


def run(proof_id: str) -> None:
    proof = named_proof(ROOT, proof_id)
    before = snapshot_inputs(ROOT, proof)
    receipt = local_path(ROOT, proof["receipt"])
    receipt.parent.mkdir(parents=True, exist_ok=True)
    # Invalidate an earlier green receipt before attempting the new test run.
    # A stopped/crashed runner must leave zero tests and a failure, not stale green.
    pending = {"version": 1, "proof_id": proof_id, "inputs": before,
               "checks": 0, "failures": 1, "cases": {}}
    temporary = receipt.with_suffix(".pending")
    temporary.write_text(json.dumps(pending), encoding="utf-8")
    temporary.replace(receipt)

    with tempfile.TemporaryDirectory(prefix="dagobert-quality-") as directory:
        result_path = Path(directory) / "result.json"
        environment = dict(os.environ, DAGOBERT_TEST_RESULT=str(result_path))
        result = subprocess.run(COMMANDS[proof_id], cwd=ROOT, env=environment,
                                timeout=180, check=False)
        if result.returncode:
            raise ContractError(f"Prüflauf {proof_id} fehlgeschlagen (Exit {result.returncode})")
        report = json.loads(result_path.read_text(encoding="utf-8"))
        if not isinstance(report, dict):
            raise ContractError("Prüflauf lieferte kein Ergebnisobjekt")
        write_receipt(ROOT, proof_id, before, report.get("cases"),
                      report.get("checks"), report.get("failures"))
        validate_receipt(ROOT, proof)
        print(f"EVIDENCE {proof_id}: {report['checks']} aktuelle benannte Prüffälle", flush=True)


def main() -> int:
    try:
        for proof_id in COMMANDS:
            run(proof_id)
    except (ContractError, OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(f"QUALITY_ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
