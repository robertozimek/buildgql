import { defineConfig } from 'tsup';

/**
 * Three configs rather than one. Each exists because one entry needs a build setting the
 * others must not have — see each config for which, and why.
 *
 * No config sets `clean`. tsup runs an array of configs under `Promise.all` (see `build()`
 * in tsup/dist/index.js) and performs its clean step inside each config's own build, so a
 * `clean: true` anywhere here would race the others' writes and non-deterministically
 * delete part of the output. `npm run build` empties `dist` once, up front, instead.
 */
const shared = {
  dts: true,
  target: 'node18',
} as const;

export default defineConfig([
  {
    ...shared,
    entry: ['src/index.ts', 'src/client/index.ts', 'src/adapters/apollo.ts', 'src/adapters/urql.ts'],
    format: ['esm', 'cjs'],
    // Without this, tsup code-splits ESM but not CJS, so `dist/index.cjs` and
    // `dist/client/index.cjs` each inlined their OWN copy of src/client/errors.ts.
    // Both entries export those classes, so a consumer who caught `BuildQLError` from
    // `buildql` got `false` for an error thrown through `buildql/client` — defeating
    // the point of having a shared base class at all. With splitting on, both `.cjs`
    // bundles require the same generated chunk and identity holds. Pinned by
    // test/built/interop.test.ts, which runs against the built output.
    //
    // ONLY entries free of dynamic `import()` may live here. See the third config.
    splitting: true,
  },
  {
    ...shared,
    // `src/cli/config.ts` is held OUT of the splitting config above, and must stay out.
    //
    // tsup implements CJS splitting by having esbuild emit ESM and then running the
    // result through sucrase with `transforms: ['imports']` (the `cjsSplitting` plugin,
    // tsup/dist/index.js ~651-670). Sucrase rewrites dynamic `import(x)` into
    // `require(x)`. `loadConfig` calls `import(pathToFileURL(path).href)` — a `file:`
    // URL, which `import()` accepts and `require()` does not:
    //
    //   buildql: failed to load buildql.config.mjs:
    //   Cannot find module 'file:///.../buildql.config.mjs'
    //
    // `exports["./config"].require` points at `dist/cli/config.cjs`, so with splitting on
    // this published entry point is dead for every CJS consumer. Splitting buys it nothing
    // anyway: config.ts imports only node builtins and ../codegen/clients.js, and never
    // touches src/client/errors.ts, so it shares no chunk with anything.
    //
    // `splitting: false` is spelled out rather than left to the default (which is already
    // false for cjs) because it is load-bearing here, not incidental — this config exists
    // for it. Pinned by test/built/interop.test.ts, which calls the built `loadConfig`
    // against a real config file rather than merely importing the module.
    entry: { 'cli/config': 'src/cli/config.ts' },
    format: ['esm', 'cjs'],
    splitting: false,
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
    // Spelled as an entry MAP, not `['src/cli/index.ts']` — same reason the config entry
    // above is. tsup derives each output path by stripping the common base directory of
    // its entry list, so a lone `src/cli/*` entry has base `src/cli` and lands on
    // `dist/index.js` — colliding with the first config's root bundle, which the configs
    // then write in parallel. The build still reports success; `bin` just points at a
    // file that no longer exists.
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
  },
]);
