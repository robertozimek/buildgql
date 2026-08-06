import { defineConfig } from 'tsup';

/**
 * Two configs rather than one, because the CLI is the only entry that must NOT be built
 * for CommonJS — see the second config for why.
 *
 * Neither config sets `clean`. tsup runs an array of configs under `Promise.all` (see
 * `build()` in tsup/dist/index.js) and performs its clean step inside each config's own
 * build, so a `clean: true` anywhere here would race the other config's writes and
 * non-deterministically delete part of the output. `npm run build` empties `dist` once,
 * up front, instead.
 */
const shared = {
  dts: true,
  target: 'node18',
} as const;

export default defineConfig([
  {
    ...shared,
    entry: [
      'src/index.ts',
      'src/client/index.ts',
      'src/cli/config.ts',
      'src/adapters/apollo.ts',
      'src/adapters/urql.ts',
    ],
    format: ['esm', 'cjs'],
    // Without this, tsup code-splits ESM but not CJS, so `dist/index.cjs` and
    // `dist/client/index.cjs` each inlined their OWN copy of src/client/errors.ts.
    // Both entries export those classes, so a consumer who caught `BuildQLError` from
    // `buildql` got `false` for an error thrown through `buildql/client` — defeating
    // the point of having a shared base class at all. With splitting on, both `.cjs`
    // bundles require the same generated chunk and identity holds. Pinned by
    // test/built/interop.test.ts, which runs against the built output.
    splitting: true,
  },
  {
    ...shared,
    // ESM only. `src/cli/index.ts` guards its main block with `import.meta.url`, which
    // has no CommonJS equivalent: esbuild either warns and compiles it to `{}` (so the
    // guard is always false and the CLI silently does nothing) or, with `splitting` on,
    // passes it through verbatim and the file throws `SyntaxError: Cannot use
    // 'import.meta' outside a module` the moment anything requires it. `bin` points at
    // the ESM build and no `exports` subpath referenced the CJS one, so it was a dead
    // artifact either way.
    //
    // Spelled as an entry MAP, not `['src/cli/index.ts']`. tsup derives each output path
    // by stripping the common base directory of its entry list, so a lone `src/cli/*`
    // entry has base `src/cli` and lands on `dist/index.js` — colliding with the other
    // config's root bundle, which both configs then write in parallel. The build still
    // reports success; `bin` just points at a file that no longer exists.
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
  },
]);
