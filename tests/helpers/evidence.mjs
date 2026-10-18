import { writeFileSync } from 'node:fs';

// Only the explicit quality runner supplies this temporary output path.
export function writeTestResult(cases, failures) {
  if (!process.env.DAGOBERT_TEST_RESULT) return;
  writeFileSync(process.env.DAGOBERT_TEST_RESULT, JSON.stringify({
    checks: Object.keys(cases).length,
    failures,
    cases
  }));
}
