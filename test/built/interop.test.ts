import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Named distinctly from `withConfigDir`'s own `run` parameter below, so neither shadows
// the other.
const execFileAsync = promisify(execFile);

/**
 * Asserts on BUILT output rather than on `src/` — as does every file in `test/built/`.
 * The siblings take the other two angles on the same output: `type-surface.test.ts` locks
 * the names `dist/index.d.ts` declares, and `declaration-resolution.test.ts` compiles a
 * real consumer to check WHICH declaration file `exports` hands it.
 *
 * Everything here is invisible to the other suites by construction: bundler config
 * decides it, every unit test imports `src/` directly, and a mistake in
 * `tsup.config.ts` or `package.json` therefore passes the whole suite and breaks
 * only for consumers. `npm run check` runs `npm run build` before `npm run test`
 * for this reason.
 *
 * (Directory named `built/` rather than `dist/` because vitest's DEFAULT `exclude`
 * contains `**` + `/dist/**`, which would silently match `test/dist/**` and collect
 * nothing at all.)
 */
const repoRoot = new URL('../../', import.meta.url);
const distDir = fileURLToPath(new URL('dist/', repoRoot));
const requireDist = createRequire(import.meta.url);

/**
 * An `exports` subpath maps either to a target string (`"./package.json"`) or to a
 * condition object whose values are themselves targets — `types` is nested one level in,
 * under each format condition, because export conditions match in KEY ORDER and a
 * top-level `types` therefore wins before `require` is ever considered (see
 * `test/built/declaration-resolution.test.ts`, which pins why).
 *
 * Typed recursively rather than as `Record<string, Record<string, string>>`: that flat
 * type describes only the shape this map used to have, and the assertions below silently
 * stop reaching the real targets the moment a condition nests.
 */
type ExportTarget = string | { readonly [condition: string]: ExportTarget };

const pkg = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8')) as {
  bin: Record<string, string>;
  main: string;
  module: string;
  types: string;
  exports: Record<string, ExportTarget>;
  typesVersions: Record<string, Record<string, string[]>>;
};

/** The shape both `buildgql` and `buildgql/client` expose; only the errors matter here. */
interface ErrorExports {
  BuildGQLError: new (message: string) => Error;
  BuildGQLHttpError: new (status: number, body: string) => Error;
  BuildGQLResponseError: new (errors: readonly { message: string }[], data?: unknown) => Error;
}

const ERROR_NAMES = ['BuildGQLError', 'BuildGQLHttpError', 'BuildGQLResponseError'] as const;

/** Every built file this suite reaches for, so an unbuilt tree fails once and by name. */
const REQUIRED = [
  'index.cjs',
  'index.js',
  'client/index.cjs',
  'client/index.js',
  'cli/config.cjs',
  'cli/config.js',
  'cli/bin.js',
  'adapters/apollo.cjs',
  'adapters/apollo.js',
  'adapters/urql.cjs',
  'adapters/urql.js',
];

/**
 * Node's resolution algorithm, minimally: walk a condition object in KEY ORDER and take
 * the first key that is `default` or one of `conditions`, recursing into nested objects.
 * Key order is not incidental here — it is the mechanism the `exports` map got wrong.
 */
function resolveExport(target: ExportTarget, conditions: readonly string[]): string | undefined {
  if (typeof target === 'string') return target;
  for (const [condition, child] of Object.entries(target)) {
    if (condition !== 'default' && !conditions.includes(condition)) continue;
    const hit = resolveExport(child, conditions);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Every `(label, target)` pair under one subpath, however deeply its conditions nest. */
function flattenTargets(target: ExportTarget, label: string): [string, string][] {
  if (typeof target === 'string') return [[label, target]];
  return Object.entries(target).flatMap(([condition, child]) =>
    flattenTargets(child, `${label}.${condition}`),
  );
}

/**
 * Every `exports` subpath that names a built bundle — i.e. all but the `./package.json`
 * passthrough, which exists so tooling can read the manifest and is not loadable as a
 * module under either condition.
 */
const BUNDLE_SUBPATHS = Object.keys(pkg.exports).filter((sub) => sub !== './package.json');

/** The absolute built file each bundle subpath resolves to under one condition. */
function exportsUnder(condition: 'import' | 'require'): [subpath: string, absolute: string][] {
  return BUNDLE_SUBPATHS.flatMap((sub) => {
    const rel = resolveExport(pkg.exports[sub], [condition]);
    return rel ? [[sub, fileURLToPath(new URL(rel, repoRoot))] as [string, string]] : [];
  });
}

beforeAll(() => {
  // Never skip when `dist/` is absent. A suite that quietly no-ops when unbuilt reads
  // as coverage and provides none — which is exactly the failure mode it exists to catch.
  const missing = REQUIRED.filter((rel) => !existsSync(`${distDir}${rel}`));
  if (missing.length > 0) {
    throw new Error(
      `buildgql: dist/ is missing ${missing.join(', ')} — this suite asserts on built output. ` +
        'Run `npm run build` first (`npm run check` does it for you).',
    );
  }
});

async function importDist(rel: string): Promise<ErrorExports> {
  return (await import(pathToFileURL(`${distDir}${rel}`).href)) as unknown as ErrorExports;
}

describe('cross-entry error class identity', () => {
  // A consumer can obtain these three classes from EITHER entry: `src/index.ts` re-exports
  // all of them and `buildgql/client` exports them too. If the two entries hold separate
  // copies, `catch (e) { if (e instanceof BuildGQLError) }` — the single reason the base
  // class exists — silently returns false for anything thrown by the other entry.

  // Each loop asserts PRESENCE before identity. `toBe` alone passes vacuously as
  // `undefined === undefined`, so dropping a class from BOTH barrels — the likeliest
  // way to lose one on a branch whose subject is barrel restructuring — would satisfy
  // the identity check while deleting the export outright. `BuildGQLResponseError` in
  // particular is never dereferenced anywhere else in this file.

  it('holds for CJS consumers (tsup does not split CJS unless told to)', () => {
    const root = requireDist(`${distDir}index.cjs`) as ErrorExports;
    const client = requireDist(`${distDir}client/index.cjs`) as ErrorExports;

    for (const name of ERROR_NAMES) {
      expect(root[name], `${name} is missing from dist/index.cjs`).toBeTypeOf('function');
      expect(client[name], `${name} is missing from dist/client/index.cjs`).toBeTypeOf('function');
      expect(client[name]).toBe(root[name]);
    }
    expect(new client.BuildGQLHttpError(500, 'x')).toBeInstanceOf(root.BuildGQLError);
    expect(new root.BuildGQLHttpError(500, 'x')).toBeInstanceOf(client.BuildGQLError);
  });

  it('holds for ESM consumers', async () => {
    // Asserted even though ESM splitting is already on by default: without this, a future
    // config change could break the working case while the CJS assertion above still passed.
    const root = await importDist('index.js');
    const client = await importDist('client/index.js');

    for (const name of ERROR_NAMES) {
      expect(root[name], `${name} is missing from dist/index.js`).toBeTypeOf('function');
      expect(client[name], `${name} is missing from dist/client/index.js`).toBeTypeOf('function');
      expect(client[name]).toBe(root[name]);
    }
    expect(new client.BuildGQLHttpError(500, 'x')).toBeInstanceOf(root.BuildGQLError);
  });
});

describe('published entry points', () => {
  it('resolves every path named in bin, exports and typesVersions', () => {
    // tsup derives an entry's output path from the common base directory of its entry
    // list, so moving one entry between configs silently relocates its output — the build
    // still reports success and `bin` just points at a file that is no longer there.
    const declared: [string, string][] = [
      ...Object.entries(pkg.bin).map(([k, v]): [string, string] => [`bin.${k}`, v]),
      ['main', pkg.main],
      ['module', pkg.module],
      ['types', pkg.types],
      ...Object.entries(pkg.exports).flatMap(([sub, target]) => flattenTargets(target, `exports["${sub}"]`)),
      ...Object.entries(pkg.typesVersions['*'] ?? {}).flatMap(([sub, paths]) =>
        paths.map((p): [string, string] => [`typesVersions["${sub}"]`, p]),
      ),
    ];

    // Pinned as an exact count, not just `> 0`: `flattenTargets` walks a recursive shape,
    // and a walker that stopped one level short would still return a non-empty list —
    // exactly the silent under-checking that the old one-level flatten did once `types`
    // moved inside the format conditions. 5 subpaths x 2 conditions x 2 keys, plus the
    // `./package.json` passthrough, plus bin/main/module/types and 4 typesVersions entries.
    expect(declared.length).toBe(29);
    const missing = declared.filter(([, p]) => !existsSync(fileURLToPath(new URL(p, repoRoot))));
    expect(missing).toEqual([]);
  });

  it('nests `types` inside each format condition, pointing require at the .d.cts', () => {
    // The declaration a consumer actually gets is decided here and nowhere else.
    // `test/built/declaration-resolution.test.ts` proves the resulting map compiles;
    // this states the invariant in one line so a regression is legible rather than
    // arriving as a wall of TS1479s.
    for (const sub of BUNDLE_SUBPATHS) {
      const target = pkg.exports[sub];
      // TypeScript's condition set always contains `types`, so a `types` key ABOVE the
      // format conditions matches first and hands CJS consumers the ESM declarations.
      expect(resolveExport(target, ['require', 'types']), `exports["${sub}"].require.types`).toMatch(
        /\.d\.cts$/,
      );
      // `.d.cts` does not end in `.d.ts`, so this excludes it without a lookbehind.
      expect(resolveExport(target, ['import', 'types']), `exports["${sub}"].import.types`).toMatch(
        /\.d\.ts$/,
      );
    }
  });

  it('keeps the shebang on the CLI binary that `bin` points at', () => {
    const bin = fileURLToPath(new URL(pkg.bin.buildgql, repoRoot));
    expect(readFileSync(bin, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('ships no CJS or declaration build of the CLI binary, which nothing can reach', () => {
    // `bin` names exactly one file and npm invokes that path directly; `bin.ts` has no
    // `exports` subpath, so `require('buildgql/bin')` fails with ERR_PACKAGE_PATH_NOT_EXPORTED
    // whatever is on disk. A `bin.cjs` therefore had no possible caller, and `bin.ts`
    // exports nothing, so its declarations were a file containing only the shebang line.
    // All three shipped in the tarball anyway until `tsup.config.ts` gave `bin.ts` its own
    // ESM-only, `dts: false` config — asserted here so a config change cannot quietly
    // reinstate dead weight in the published package.
    for (const dead of ['cli/bin.cjs', 'cli/bin.d.ts', 'cli/bin.d.cts']) {
      expect(existsSync(`${distDir}${dead}`), `dist/${dead} is published but unreachable`).toBe(false);
    }
  });

  // Existence is not loadability. `splitting: true` rewrites the CJS bundles through
  // sucrase, which can produce a file that stats fine and throws on require — so every
  // published bundle is actually loaded, in the module system its condition promises.

  it('loads every CJS bundle named in exports.require', () => {
    const entries = exportsUnder('require');
    expect(entries.length).toBe(BUNDLE_SUBPATHS.length);
    for (const [sub, abs] of entries) {
      const mod = requireDist(abs) as Record<string, unknown>;
      expect(Object.keys(mod).length, `buildgql${sub.slice(1)} loaded but exported nothing`).toBeGreaterThan(
        0,
      );
    }
  });

  it('loads every ESM bundle named in exports.import', async () => {
    const entries = exportsUnder('import');
    expect(entries.length).toBe(BUNDLE_SUBPATHS.length);
    for (const [sub, abs] of entries) {
      const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
      expect(Object.keys(mod).length, `${sub} loaded but exported nothing`).toBeGreaterThan(0);
    }
  });

  // `bin` has no `exports` entry and — unlike the old `cli/index.js`, whose main block sat
  // behind an `isEntrypoint(import.meta.url, process.argv[1])` guard — `dist/cli/bin.js` now
  // calls `main()` unconditionally on load. Importing it in-process here would run `main()`
  // against THIS test process's own argv and set `process.exitCode` on the test runner
  // itself, corrupting the very run that's meant to verify it. So it is spawned as a real
  // child process instead. This proves the compiled entry actually starts up, resolves its
  // module graph, and produces the right stdout under Node — NOT that the shebang line
  // works: `execFile(process.execPath, [bin, ...])` invokes `node <file>` directly, which
  // never reads the shebang at all. The assertion below (`keeps the shebang on the CLI
  // binary...`) is the one that actually covers the shebang, by reading the file's first
  // bytes.
  it('runs as a real child process and prints usage on --help', async () => {
    const bin = fileURLToPath(new URL(pkg.bin.buildgql, repoRoot));
    const { stdout } = await execFileAsync(process.execPath, [bin, '--help']);
    expect(stdout).toContain('type-safe GraphQL query builder codegen');
  });

  // `bin.ts` returns its exit code through `void main(...).then((code) => { process.exitCode
  // = code })` — nothing else makes the child process actually exit nonzero on failure. The
  // test above only ever invokes `--help`, which succeeds, so it cannot catch that wiring
  // being dropped (e.g. by an `await`-based refactor that loses the assignment, or by the
  // `.then` being deleted outright — the child would still print its error text to stderr
  // and exit 0, indistinguishable from success to any script piping into it). Spawning with a
  // deliberately-unknown command forces the failing path and asserts on `execFile`'s own
  // rejection, which `promisify` produces only for a nonzero exit code.
  it('exits nonzero when the command fails, not just zero when it succeeds', async () => {
    const bin = fileURLToPath(new URL(pkg.bin.buildgql, repoRoot));
    await expect(execFileAsync(process.execPath, [bin, 'bogus'])).rejects.toMatchObject({ code: 1 });
  });
});

describe('the optional `graphql` peer dependency stays out of the core entries', () => {
  // `graphql` is an OPTIONAL peer dependency. Only `src/adapters/**`, `src/codegen/**` and
  // `src/cli/**` may reach it — `src/index.ts`, `src/client/**`, `src/runtime/**` and
  // `src/types/**` must not, at type level or runtime. If that ever breaks, a consumer who
  // did not install `graphql` gets ERR_MODULE_NOT_FOUND on the package's MAIN entry point:
  // the most severe consumer-facing failure this library has.
  //
  // The boundary was intact when this test was written and held only by manual grep — no
  // test and no lint rule enforced it. It is also invisible to every `src/`-level suite,
  // which resolves `graphql` from this repo's own devDependencies and so cannot tell an
  // imported one from an absent one. `eslint.config.js` now carries a `no-restricted-imports`
  // rule over the same four directories as cheap defence in depth; this is the check that
  // sees what actually shipped.

  /** `from 'graphql'`, `import('graphql')`, `import 'graphql'`, `require('graphql')`, deep paths too. */
  const GRAPHQL_SPECIFIER = /\b(?:from|import|require)\s*\(?\s*['"]graphql(?:\/[^'"]*)?['"]/;
  /** The same four forms, but capturing a relative specifier so the graph can be walked. */
  const RELATIVE_SPECIFIER = /\b(?:from|import|require)\s*\(?\s*['"](\.[^'"]*)['"]/g;

  const CORE_SUBPATHS = ['.', './client', './config'];

  /**
   * The entry file plus every built file it reaches through a relative specifier.
   *
   * Following the graph is the whole point. tsup code-splits the entry group containing
   * `.` and `./client`, so almost all of their code lives in a `chunk-*.js` / `chunk-*.cjs`
   * that the entry merely re-exports. A check that read only the entry files would report
   * a clean boundary while the leak shipped inside the chunk — a guard that exists and
   * does nothing.
   */
  function reachableFrom(entry: string): Map<string, string> {
    const seen = new Map<string, string>();
    const walk = (file: string): void => {
      if (seen.has(file) || !existsSync(file)) return;
      const source = readFileSync(file, 'utf8');
      seen.set(file, source);
      for (const match of source.matchAll(RELATIVE_SPECIFIER)) walk(resolve(dirname(file), match[1]));
    };
    walk(entry);
    return seen;
  }

  function coreEntries(condition: 'import' | 'require'): [subpath: string, absolute: string][] {
    const entries = exportsUnder(condition).filter(([sub]) => CORE_SUBPATHS.includes(sub));
    // Asserted, not assumed: renaming a subpath would otherwise reduce this whole describe
    // block to a loop over nothing that still reports as passing.
    expect(entries.map(([sub]) => sub)).toEqual(CORE_SUBPATHS);
    return entries;
  }

  it.each(['import', 'require'] as const)(
    'is absent from every %s bundle and from every chunk it reaches',
    (condition) => {
      for (const [sub, abs] of coreEntries(condition)) {
        for (const [file, source] of reachableFrom(abs)) {
          expect(
            source,
            `buildgql${sub.slice(1)} reaches ${relative(distDir, file)}, which imports graphql`,
          ).not.toMatch(GRAPHQL_SPECIFIER);
        }
      }
    },
  );

  it('walks past the entry file into the shared chunk', () => {
    // Without this, the two assertions above could quietly degrade to an entry-file-only
    // grep — they would still pass, while a leak inside `chunk-*` shipped unseen. Both
    // formats are named because CJS splitting is opt-in (`splitting: true` in
    // tsup.config.ts): if it were dropped, the CJS entries would stop having a chunk to
    // walk into and this states that expectation out loud rather than degrading silently.
    for (const condition of ['import', 'require'] as const) {
      for (const [sub, abs] of coreEntries(condition).filter(([s]) => s !== './config')) {
        const reached = [...reachableFrom(abs).keys()].map((f) => relative(distDir, f));
        expect(
          reached.some((f) => f.startsWith('chunk-')),
          `${sub} under ${condition}: ${reached.join(', ')}`,
        ).toBe(true);
      }
    }
  });
});

describe('loadConfig, called from the built bundles', () => {
  // The only assertions in this file that call INTO a built bundle rather than merely
  // loading it — and the only ones that catch this class of bug at all.
  //
  // tsup implements CJS splitting by running the output through sucrase, which rewrites
  // dynamic `import(x)` into `require(x)`. `loadConfig` imports a `file:` URL, which
  // `import()` accepts and `require()` rejects with "Cannot find module 'file:///...'".
  // Importing `config.cjs` does not notice: the rewritten call sits inside
  // `defaultImporter` and only fails when a config is actually loaded. That shipped a
  // dead `exports["./config"].require` past a fully green gate once already.

  function withConfigDir(run: (dir: string) => Promise<void>): () => Promise<void> {
    return async () => {
      const dir = mkdtempSync(join(tmpdir(), 'buildgql-config-'));
      try {
        writeFileSync(
          join(dir, 'buildgql.config.mjs'),
          "export default { schema: './schema.graphql', output: './out' };\n",
        );
        await run(dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
  }

  interface ConfigModule {
    loadConfig: (cwd: string) => Promise<{ config: { schema: string; output?: string }; path: string }>;
  }

  it(
    'resolves a real buildgql.config.mjs from the CJS bundle',
    withConfigDir(async (dir) => {
      const mod = requireDist(`${distDir}cli/config.cjs`) as ConfigModule;
      const loaded = await mod.loadConfig(dir);
      expect(loaded.config.schema).toBe('./schema.graphql');
      expect(loaded.path).toBe(join(dir, 'buildgql.config.mjs'));
    }),
  );

  it(
    'resolves a real buildgql.config.mjs from the ESM bundle',
    withConfigDir(async (dir) => {
      const mod = (await import(pathToFileURL(`${distDir}cli/config.js`).href)) as unknown as ConfigModule;
      const loaded = await mod.loadConfig(dir);
      expect(loaded.config.schema).toBe('./schema.graphql');
      expect(loaded.path).toBe(join(dir, 'buildgql.config.mjs'));
    }),
  );
});
