import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it } from 'vitest';
import * as ts from 'typescript';

/**
 * Closes a gap `test/unit/public-api.test.ts` cannot: `Object.keys(api)` only ever sees
 * VALUE exports — a type-only export (`export type { HeadersSource }`) has no runtime
 * binding, so it never appears in that list either present or absent. Of the 59 names
 * `src/index.ts` exports, 37 are type-only, and as of this file's addition only ONE of
 * those 37 (`Operation`, via an `import type` in `test/e2e/`) was referenced anywhere
 * under `test/`. Deleting `export type { HeadersSource }` — a name Task 8 deliberately
 * added — passed the entire test suite before this file existed.
 *
 * Runs against `dist/index.d.ts`, the file `package.json`'s `exports["."].types` actually
 * points consumers at, rather than `src/index.ts`. That file re-exports through
 * content-hashed, single-letter-aliased chunk files —
 *
 *   export { k as AnyFieldSelection, l as Arg, ... } from './operation-DxbEION8.js';
 *
 * — because `dts: true` bundles declarations per tsup's own chunking, and the alias and
 * the hash both change across rebuilds. A regex over that text would have to either match
 * the aliasing scheme (fragile: it's tsup/rollup internal behaviour, not a contract) or
 * miss it (silently checking the wrong 41 characters). The TypeScript compiler API doesn't
 * have this problem: `checker.getExportsOfModule` resolves re-exports, including aliased
 * and multi-hop ones, down to the name a consumer actually imports — the same resolution
 * `import { AnyFieldSelection } from 'buildql'` goes through in a real consumer's project.
 */

const repoRoot = new URL('../../', import.meta.url);
const dtsPath = fileURLToPath(new URL('dist/index.d.ts', repoRoot));

/**
 * Every name `dist/index.d.ts` exports, values and types alike, hand-maintained and
 * sorted. Adding or removing an export from `src/index.ts` — of EITHER kind — means
 * editing this array in the same commit, same as `test/unit/public-api.test.ts`'s list
 * does for the value-only subset.
 */
const EXPECTED_EXPORTS = [
  '$',
  'AnyFieldSelection',
  'Apply',
  'Arg',
  'ArgSpec',
  'ArgsInput',
  'BuildQLError',
  'BuildQLHttpError',
  'BuildQLResponseError',
  'Client',
  'ClientOptions',
  'Directive',
  'ExecuteOptions',
  'FieldSelection',
  'Fragment',
  'FragmentDefinition',
  'FragmentSpread',
  'GraphQLFormattedError',
  'HeadersSource',
  'InlineFragment',
  'KEY',
  'NonNull',
  'Operation',
  'RESULT',
  'Selected',
  'SelectionNode',
  'Simplify',
  'SseTransportOptions',
  'StreamChunk',
  'SubscribePayload',
  'SubscriptionTransport',
  'UnionToIntersection',
  'VARS',
  'VERSION',
  'VarMarker',
  'VarProxy',
  'VarRef',
  'VarsIn',
  'VarsOf',
  'Wrap',
  'WrapTok',
  'WsTransportOptions',
  'argSpec',
  'createClient',
  'include',
  'leafField',
  'leafFieldArgs',
  'makeFragment',
  'makeMutation',
  'makeQuery',
  'makeSubscription',
  'objectField',
  'objectFieldArgs',
  'on',
  'skip',
  'spread',
  'sseTransport',
  'v',
  'wsTransport',
].sort();

beforeAll(() => {
  // Same convention as test/built/interop.test.ts: fail loudly and by name on an unbuilt
  // tree rather than silently collecting nothing.
  if (!existsSync(dtsPath)) {
    throw new Error(
      'buildql: dist/index.d.ts is missing — this suite asserts on built output. ' +
        'Run `npm run build` first (`npm run check` does it for you).',
    );
  }
});

it('locks the full declared export surface (values and type-only) of dist/index.d.ts', () => {
  // A throwaway single-file Program, not a full project build — `rootNames` is just the
  // one entry, and TypeScript's module resolution follows its `export ... from './x.js'`
  // statements into the chunk files on demand. `module`/`moduleResolution` mirror
  // tsconfig.json's so `.js`-extension specifiers resolve to their `.d.ts` siblings the
  // same way they do for a real consumer.
  const program = ts.createProgram({
    rootNames: [dtsPath],
    options: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2020,
      skipLibCheck: true,
      noEmit: true,
    },
  });

  const sourceFile = program.getSourceFile(dtsPath);
  if (!sourceFile) {
    throw new Error(`buildql: TypeScript could not load ${dtsPath} as a source file`);
  }

  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    throw new Error(`buildql: ${dtsPath} has no module symbol — is it still an ES module?`);
  }

  const actual = checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol) => symbol.name)
    .sort();

  expect(actual).toEqual(EXPECTED_EXPORTS);
});
