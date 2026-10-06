// Runs each test file in its own Vitest process.
// On Windows the Vitest worker sometimes crashes natively (0xC0000409) while PGlite is busy, roughly once
// in six runs of a big file. Only that kind of crash is retried (twice at most, and reported). A normal
// test failure is never retried. Production uses real PostgreSQL, not PGlite.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const NATIVE_CRASH_CODES = new Set([3221226505, 127, -1073740791]);
const MAX_RETRIES = 2;
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync('tests').filter((f) => f.endsWith('.test.ts')).sort().map((f) => `tests/${f}`);

const results = [];
for (const file of files) {
  let attempt = 0;
  let outcome;
  for (;;) {
    attempt += 1;
    const run = spawnSync('npx', ['vitest', 'run', file], { encoding: 'utf8', shell: true });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const tests = /Tests\s+(.*)\n/.exec(output)?.[1]?.trim() ?? 'no summary';
    const crashed = NATIVE_CRASH_CODES.has(run.status ?? -1) || /exited unexpectedly with exit code 3221226505/.test(output);
    outcome = { file, status: run.status, tests, attempts: attempt, crashed, output };
    if (crashed && attempt <= MAX_RETRIES) {
      console.log(`RETRY ${file}: native worker crash (exit ${run.status}) on attempt ${attempt}`);
      continue;
    }
    break;
  }
  const ok = outcome.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}  ${outcome.tests}${outcome.attempts > 1 ? `  (attempts: ${outcome.attempts})` : ''}`);
  if (!ok) console.log(outcome.output.split('\n').slice(-60).join('\n'));
  results.push(outcome);
}

const passed = results.filter((r) => r.status === 0).length;
const total = results.reduce((n, r) => n + Number(/(\d+) passed/.exec(r.tests)?.[1] ?? 0), 0);
const retried = results.filter((r) => r.attempts > 1).length;
console.log(`\n${passed}/${results.length} test files passed; ${total} tests passed; ${retried} file(s) needed a retry after a native worker crash.`);
process.exit(passed === results.length ? 0 : 1);
