import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it } from 'vitest';
import * as ts from 'typescript';

/**
 * Does a TypeScript consumer get declarations that MATCH the module format it will
 * actually load?
 *
 * Nothing else in this repo can answer that. `test/built/type-surface.test.ts` reads
 * `dist/index.d.ts` by absolute path, `test/built/interop.test.ts` loads the bundles by
 * absolute path, and every other suite imports `src/` — so all of them bypass
 * `package.json`'s `exports` map, which is the only thing that decides WHICH declaration
 * file a consumer sees. That map shipped this defect past a fully green gate:
 *
 *   ".": { "types": "./dist/index.d.ts", "import": "...", "require": "./dist/index.cjs" }
 *
 * Export conditions match in KEY ORDER, and `types` is in TypeScript's condition set for
 * every consumer, so it won before `require` was ever considered. Every CJS consumer got
 * `dist/index.d.ts` — an ES module, because the package is `"type": "module"` — while
 * `require()` handed them `dist/index.cjs` at runtime. Types and runtime disagreed, and
 * `tsc` refused to compile the package at all:
 *
 *   TS1479: The current file is a CommonJS module whose imports will produce 'require'
 *   calls; however, the referenced file is an ECMAScript module and cannot be imported
 *   with 'require'.
 *
 * The fix is to nest `types` INSIDE each format condition and point `require.types` at the
 * `.d.cts` files tsup already emits. This test pins that by doing what a consumer does:
 * install the package into a `node_modules`, then compile a `.cts` and a `.mts` file
 * against it under `moduleResolution: node16` and demand zero diagnostics.
 *
 * `node16` specifically, not `bundler`: `bundler` ignores the ESM/CJS distinction, so it
 * resolves the broken map without complaint and would have reported this as passing.
 *
 * Chosen over `publint` / `@arethetypeswrong/cli` — which cover the same class — because
 * both are extra dependencies for a check the compiler already performs, and because
 * compiling real fixture files pins the actual consumer experience rather than a
 * third-party model of it. `typescript` is already both a devDependency and a peer
 * dependency here, and `test/built/type-surface.test.ts` established the compiler-API
 * pattern.
 */

const repoRoot = new URL('../../', import.meta.url);
const distDir = fileURLToPath(new URL('dist/', repoRoot));
const packageJsonPath = fileURLToPath(new URL('package.json', repoRoot));
const graphqlDir = fileURLToPath(new URL('node_modules/graphql', repoRoot));

/** Every subpath `exports` publishes, imported by both fixtures. */
const SUBPATHS = [
  'buildql',
  'buildql/client',
  'buildql/config',
  'buildql/adapters/apollo',
  'buildql/adapters/urql',
];

/**
 * Namespace imports rather than named ones, deliberately: this test is about which
 * declaration FILE resolves, and the export names inside it are already locked by
 * `test/built/type-surface.test.ts` and `test/unit/public-api.test.ts`. Naming exports
 * here would only couple this test to churn it has no opinion about.
 */
function fixture(): string {
  const imports = SUBPATHS.map((sub, i) => `import * as m${i} from '${sub}';`).join('\n');
  const uses = SUBPATHS.map((_, i) => `m${i}`).join(', ');
  return `${imports}\nexport const used: unknown[] = [${uses}];\n`;
}

beforeAll(() => {
  // The `.d.cts` declarations are what `require.types` points at. They are emitted by
  // `dts: true` and were sitting unreferenced in `dist/` for the entire life of the bug,
  // so assert them by name: without them this test's premise is gone.
  const missing = [
    'index.d.cts',
    'client/index.d.cts',
    'cli/config.d.cts',
    'adapters/apollo.d.cts',
    'adapters/urql.d.cts',
  ].filter((rel) => !existsSync(`${distDir}${rel}`));
  if (missing.length > 0) {
    throw new Error(
      `buildql: dist/ is missing ${missing.join(', ')} — this suite asserts on built output. ` +
        'Run `npm run build` first (`npm run check` does it for you).',
    );
  }
  if (!existsSync(graphqlDir)) {
    throw new Error('buildql: node_modules/graphql is missing — the adapter declarations import it.');
  }
});

/**
 * A throwaway consumer project with a real `node_modules/buildql` in it.
 *
 * `dist/` and `package.json` are COPIED, not symlinked: the point of the exercise is that
 * resolution goes through the published `exports` map from a plain directory, exactly as
 * it does after `npm install`. `graphql` is symlinked instead — it is a heavy tree, it is
 * only here because the adapter declarations say `import 'graphql'`, and package managers
 * hoist and link it in real installs anyway.
 */
function withConsumer(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'buildql-dts-'));
  try {
    const installed = join(dir, 'node_modules', 'buildql');
    mkdirSync(installed, { recursive: true });
    cpSync(distDir, join(installed, 'dist'), { recursive: true });
    copyFileSync(packageJsonPath, join(installed, 'package.json'));
    symlinkSync(graphqlDir, join(dir, 'node_modules', 'graphql'), 'dir');
    writeFileSync(join(dir, 'package.json'), '{ "name": "consumer", "type": "commonjs" }\n');
    writeFileSync(join(dir, 'consumer.cts'), fixture());
    writeFileSync(join(dir, 'consumer.mts'), fixture());
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it('compiles from both a .cts and a .mts consumer under moduleResolution node16', () => {
  withConsumer((dir) => {
    const program = ts.createProgram({
      rootNames: [join(dir, 'consumer.cts'), join(dir, 'consumer.mts')],
      options: {
        module: ts.ModuleKind.Node16,
        moduleResolution: ts.ModuleResolutionKind.Node16,
        target: ts.ScriptTarget.ES2022,
        strict: true,
        noEmit: true,
        // The declarations' own internals are not this test's subject — resolution is.
        // `graphql`'s declarations alone would otherwise dominate the runtime of a check
        // that has no opinion about them.
        skipLibCheck: true,
        types: [],
      },
    });

    // `getPreEmitDiagnostics` rather than `getSemanticDiagnostics`: TS1479 is raised while
    // the program's module graph is built, and only the aggregate call is guaranteed to
    // carry every category (options, global, syntactic, semantic) that a real `tsc` run
    // would print.
    const messages = ts
      .getPreEmitDiagnostics(program)
      .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);

    expect(messages).toEqual([]);
  });
});
