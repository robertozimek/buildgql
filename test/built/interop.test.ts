import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const REQUIRED = ['index.cjs', 'index.js', 'client/index.cjs', 'client/index.js', 'cli/index.js'];

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

  it('holds for CJS consumers (tsup does not split CJS unless told to)', () => {
    const root = requireDist(`${distDir}index.cjs`) as ErrorExports;
    const client = requireDist(`${distDir}client/index.cjs`) as ErrorExports;

    for (const name of ERROR_NAMES) expect(client[name]).toBe(root[name]);
    expect(new client.BuildQLHttpError(500, 'x')).toBeInstanceOf(root.BuildQLError);
    expect(new root.BuildQLHttpError(500, 'x')).toBeInstanceOf(client.BuildQLError);
  });

  it('holds for ESM consumers', async () => {
    // Asserted even though ESM splitting is already on by default: without this, a future
    // config change could break the working case while the CJS assertion above still passed.
    const root = await importDist('index.js');
    const client = await importDist('client/index.js');

    for (const name of ERROR_NAMES) expect(client[name]).toBe(root[name]);
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
});
