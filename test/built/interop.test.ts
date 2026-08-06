import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Named distinctly from `withConfigDir`'s own `run` parameter below, so neither shadows
// the other.
const execFileAsync = promisify(execFile);

/**
 * The only suite in this repo that asserts on BUILT output rather than on `src/`.
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

const pkg = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8')) as {
  bin: Record<string, string>;
  main: string;
  module: string;
  types: string;
  exports: Record<string, Record<string, string>>;
  typesVersions: Record<string, Record<string, string[]>>;
};

/** The shape both `buildql` and `buildql/client` expose; only the errors matter here. */
interface ErrorExports {
  BuildQLError: new (message: string) => Error;
  BuildQLHttpError: new (status: number, body: string) => Error;
  BuildQLResponseError: new (errors: readonly { message: string }[], data?: unknown) => Error;
}

const ERROR_NAMES = ['BuildQLError', 'BuildQLHttpError', 'BuildQLResponseError'] as const;

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

/** The absolute built file each `exports` subpath resolves to under one condition. */
function exportsUnder(condition: 'import' | 'require'): [subpath: string, absolute: string][] {
  return Object.entries(pkg.exports).flatMap(([sub, conds]) => {
    const rel = conds[condition];
    return rel ? [[sub, fileURLToPath(new URL(rel, repoRoot))] as [string, string]] : [];
  });
}

beforeAll(() => {
  // Never skip when `dist/` is absent. A suite that quietly no-ops when unbuilt reads
  // as coverage and provides none — which is exactly the failure mode it exists to catch.
  const missing = REQUIRED.filter((rel) => !existsSync(`${distDir}${rel}`));
  if (missing.length > 0) {
    throw new Error(
      `buildql: dist/ is missing ${missing.join(', ')} — this suite asserts on built output. ` +
        'Run `npm run build` first (`npm run check` does it for you).',
    );
  }
});

async function importDist(rel: string): Promise<ErrorExports> {
  return (await import(pathToFileURL(`${distDir}${rel}`).href)) as unknown as ErrorExports;
}

describe('cross-entry error class identity', () => {
  // A consumer can obtain these three classes from EITHER entry: `src/index.ts` re-exports
  // all of them and `buildql/client` exports them too. If the two entries hold separate
  // copies, `catch (e) { if (e instanceof BuildQLError) }` — the single reason the base
  // class exists — silently returns false for anything thrown by the other entry.

  // Each loop asserts PRESENCE before identity. `toBe` alone passes vacuously as
  // `undefined === undefined`, so dropping a class from BOTH barrels — the likeliest
  // way to lose one on a branch whose subject is barrel restructuring — would satisfy
  // the identity check while deleting the export outright. `BuildQLResponseError` in
  // particular is never dereferenced anywhere else in this file.

  it('holds for CJS consumers (tsup does not split CJS unless told to)', () => {
    const root = requireDist(`${distDir}index.cjs`) as ErrorExports;
    const client = requireDist(`${distDir}client/index.cjs`) as ErrorExports;

    for (const name of ERROR_NAMES) {
      expect(root[name], `${name} is missing from dist/index.cjs`).toBeTypeOf('function');
      expect(client[name], `${name} is missing from dist/client/index.cjs`).toBeTypeOf('function');
      expect(client[name]).toBe(root[name]);
    }
    expect(new client.BuildQLHttpError(500, 'x')).toBeInstanceOf(root.BuildQLError);
    expect(new root.BuildQLHttpError(500, 'x')).toBeInstanceOf(client.BuildQLError);
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
    expect(new client.BuildQLHttpError(500, 'x')).toBeInstanceOf(root.BuildQLError);
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
      ...Object.entries(pkg.exports).flatMap(([sub, conds]) =>
        Object.entries(conds).map(([cond, p]): [string, string] => [`exports["${sub}"].${cond}`, p]),
      ),
      ...Object.entries(pkg.typesVersions['*'] ?? {}).flatMap(([sub, paths]) =>
        paths.map((p): [string, string] => [`typesVersions["${sub}"]`, p]),
      ),
    ];

    expect(declared.length).toBeGreaterThan(0);
    const missing = declared.filter(([, p]) => !existsSync(fileURLToPath(new URL(p, repoRoot))));
    expect(missing).toEqual([]);
  });

  it('keeps the shebang on the CLI binary that `bin` points at', () => {
    const bin = fileURLToPath(new URL(pkg.bin.buildql, repoRoot));
    expect(readFileSync(bin, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
  });

  // Existence is not loadability. `splitting: true` rewrites the CJS bundles through
  // sucrase, which can produce a file that stats fine and throws on require — so every
  // published bundle is actually loaded, in the module system its condition promises.

  it('loads every CJS bundle named in exports.require', () => {
    const entries = exportsUnder('require');
    expect(entries.length).toBe(Object.keys(pkg.exports).length);
    for (const [sub, abs] of entries) {
      const mod = requireDist(abs) as Record<string, unknown>;
      expect(Object.keys(mod).length, `buildql${sub.slice(1)} loaded but exported nothing`).toBeGreaterThan(
        0,
      );
    }
  });

  it('loads every ESM bundle named in exports.import', async () => {
    const entries = exportsUnder('import');
    expect(entries.length).toBe(Object.keys(pkg.exports).length);
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
    const bin = fileURLToPath(new URL(pkg.bin.buildql, repoRoot));
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
    const bin = fileURLToPath(new URL(pkg.bin.buildql, repoRoot));
    await expect(execFileAsync(process.execPath, [bin, 'bogus'])).rejects.toMatchObject({ code: 1 });
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
      const dir = mkdtempSync(join(tmpdir(), 'buildql-config-'));
      try {
        writeFileSync(
          join(dir, 'buildql.config.mjs'),
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
    'resolves a real buildql.config.mjs from the CJS bundle',
    withConfigDir(async (dir) => {
      const mod = requireDist(`${distDir}cli/config.cjs`) as ConfigModule;
      const loaded = await mod.loadConfig(dir);
      expect(loaded.config.schema).toBe('./schema.graphql');
      expect(loaded.path).toBe(join(dir, 'buildql.config.mjs'));
    }),
  );

  it(
    'resolves a real buildql.config.mjs from the ESM bundle',
    withConfigDir(async (dir) => {
      const mod = (await import(pathToFileURL(`${distDir}cli/config.js`).href)) as unknown as ConfigModule;
      const loaded = await mod.loadConfig(dir);
      expect(loaded.config.schema).toBe('./schema.graphql');
      expect(loaded.path).toBe(join(dir, 'buildql.config.mjs'));
    }),
  );
});
