import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const BUDGET_INSTANTIATIONS = 25_000;
const BUDGET_CHECK_SECONDS = 3;

await import('../test/perf/schema.gen.mjs');

await writeFile(
  new URL('../test/perf/tsconfig.json', import.meta.url),
  JSON.stringify({
    extends: '../../tsconfig.json',
    // Declaration emit forces TS to compute a serializable type for every
    // exported const even under noEmit, which blows up on this fixture's
    // deliberately huge inferred types (TS4023/TS7056). This fixture is
    // internal-only, so declaration output is irrelevant here.
    compilerOptions: { declaration: false },
    include: ['generated.ts'],
    // Override the inherited `exclude: ["test/perf"]` (resolved relative to
    // the base tsconfig's directory), which would otherwise re-exclude the
    // very file this config includes.
    exclude: [],
  }),
);

const out = execFileSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'test/perf/tsconfig.json', '--extendedDiagnostics'],
  { encoding: 'utf8' },
);

const num = (label) => Number(out.match(new RegExp(`${label}:\\s+([\\d.]+)`))?.[1] ?? NaN);
const instantiations = num('Instantiations');
const checkTime = num('Check time');

console.log(`instantiations: ${instantiations} (budget ${BUDGET_INSTANTIATIONS})`);
console.log(`check time:     ${checkTime}s (budget ${BUDGET_CHECK_SECONDS}s)`);

if (!Number.isFinite(instantiations) || instantiations > BUDGET_INSTANTIATIONS) {
  console.error('buildgql: type instantiation budget exceeded');
  process.exit(1);
}
if (!Number.isFinite(checkTime) || checkTime > BUDGET_CHECK_SECONDS) {
  console.error('buildgql: type check time budget exceeded');
  process.exit(1);
}
