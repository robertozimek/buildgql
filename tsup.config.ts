import { defineConfig } from 'tsup';

/**
 * Three configs rather than one. Each exists because one entry needs a build setting the
 * others must not have — see each config for which, and why.
 *
 * No config sets `clean`. tsup runs an array of configs under `Promise.all` (see `build()`
 * in tsup/dist/index.js) and performs its clean step inside each config's own build, so a
 * `clean: true` anywhere here would race the other's writes and non-deterministically
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
    // ONLY entries free of dynamic `import()` may live here. See the second config.
    splitting: true,
  },
  {
    ...shared,
    // `src/cli/config.ts` and `src/cli/bin.ts` are held OUT of the splitting config above,
    // and must stay out. They are split across two configs of their own because only
    // `config.ts` is a published module; see the third config for `bin.ts`.
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
    //
    // Spelled as an entry MAP, not an array. tsup derives each output path by stripping
    // the common base directory of its own entry list, so an array of `src/cli/*` paths
    // would have base `src/cli` and land each file at `dist/config.js` — colliding with the
    // first config's root bundle, which these configs then write in parallel. The build
    // still reports success; the output just lands somewhere nothing points at.
    entry: { 'cli/config': 'src/cli/config.ts' },
    format: ['esm', 'cjs'],
    splitting: false,
  },
  {
    ...shared,
    // The CLI binary. ESM only, and no declarations — both on purpose.
    //
    // `bin.ts` is reachable ONLY through `package.json`'s `bin` field, which names exactly
    // one file (`./dist/cli/bin.js`), and npm invokes that path directly rather than
    // resolving it as a module. There is no `exports` subpath for it, so every module
    // specifier a consumer could write — `buildql/bin`, `buildql/cli/bin` — fails with
    // `ERR_PACKAGE_PATH_NOT_EXPORTED` no matter what is on disk. A `bin.cjs` therefore had
    // no possible caller: it shipped in the tarball, was listed in `sideEffects`, and
    // nothing could load it. Declarations were worse than useless — `bin.ts` exports
    // nothing, so `dts: true` emitted a `bin.d.ts`/`bin.d.cts` whose entire contents were
    // the shebang line. Both are dropped here for the same reason a prior task dropped the
    // `cli/generate` publish entry: unreachable output is dead weight in the tarball and a
    // standing invitation to wire something up to it by mistake. Pinned by
    // test/built/interop.test.ts, which asserts all three files are absent from `dist/`.
    //
    // `splitting: false` is load-bearing here even though only one format is emitted: tsup
    // defaults it to TRUE for esm, and a chunk would make `dist/cli/bin.js` — the file npm
    // symlinks onto a user's PATH — depend on a sibling it has no `exports` entry for.
    //
    // Held out of the `splitting: true` config for the same reason `config.ts` is:
    // `bin.ts` imports `main.ts`, which imports `config.ts`, so `loadConfig`'s dynamic
    // `import(pathToFileURL(...).href)` would be dragged into `bin.ts`'s bundle too, and
    // `main.ts` also imports `generate.ts`, which transitively reaches
    // `codegen/introspect.ts`'s `await import('graphql')` — a second dynamic import in the
    // same graph, and sucrase would rewrite both to `require()`. It shares no chunk with
    // `src/index.ts` or `src/client/index.ts` either (the CLI never imports
    // `client/errors.ts`), so splitting would buy it nothing regardless.
    //
    // `src/cli/generate.ts` is NOT listed as its own entry, deliberately: it has no
    // `exports` subpath (only `main.ts` and the CLI's own tests import it, both straight
    // from `src/`, not from `dist/`), so building it standalone would ship exactly the kind
    // of unreachable file this config exists to avoid. Its code still ships: esbuild inlines
    // its whole graph into `bin.js`, which is how `buildql generate` keeps working. If a
    // real consumer ever needs to embed the pipeline directly (the reason `reporter.ts`
    // exists as a port in the first place), add `./generate` to `exports` and
    // `typesVersions` and give it an entry — until then it stays internal.
    dts: false,
    entry: { 'cli/bin': 'src/cli/bin.ts' },
    format: ['esm'],
    splitting: false,
  },
]);
