import { execFile } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

/**
 * `npx buildql` / `pnpm dlx buildql` — the way most people run this CLI the first time.
 *
 * What makes that case different from every other suite here is MODULE RESOLUTION, and
 * nothing else. Under npx the binary is unpacked into a throwaway cache directory
 * (`~/.npm/_npx/<hash>/node_modules/buildql/`) that has no relationship to the user's
 * project, and Node resolves a bare specifier by walking up from the importing FILE. So
 * `import('graphql')` inside the CLI searches the npx cache — where npm has installed no
 * optional peer — and never sees the `graphql` sitting in the project two directories
 * away. Reading an SDL schema needs `graphql`, so the whole npx path failed with advice
 * ("install graphql") the user had already followed.
 *
 * Every other suite in this repo runs the CLI from inside this repository, whose own
 * `node_modules` contains `graphql`, so `import('graphql')` succeeds there and the npx
 * condition is invisible to all of them — including `test/e2e`, which shells out to the
 * built binary but leaves it sitting in the repo.
 *
 * Reproduced here by COPYING `dist/cli/bin.js` into a temp directory laid out like the npx
 * cache, so that the copy has no `graphql` anywhere above it. That is faithful rather than
 * approximate: `bin.js` is bundled with `graphql` as its only external (it is a peer
 * dependency, hence not inlined), so the copy is exactly the file npx would run, minus
 * the `~15s` of a real `npm install`.
 */
const repoRoot = new URL('../../', import.meta.url);
const builtBin = fileURLToPath(new URL('dist/cli/bin.js', repoRoot));
const repoGraphql = fileURLToPath(new URL('node_modules/graphql', repoRoot));
const sdlFixture = fileURLToPath(new URL('test/fixtures/schema.graphql', repoRoot));

const CONFIG = "export default { schema: './schema.graphql', output: './gql' };\n";

const temps: string[] = [];

function mkTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

beforeAll(() => {
  // Never skip when unbuilt — a suite that quietly no-ops reads as coverage and is none.
  // Same rule as test/built/interop.test.ts, which explains it at length.
  if (!existsSync(builtBin)) {
    throw new Error(
      'buildql: dist/cli/bin.js is missing — this suite runs the BUILT binary. ' +
        'Run `npm run build` first (`npm run check` does it for you).',
    );
  }
  if (!existsSync(repoGraphql)) {
    throw new Error(
      `buildql: ${repoGraphql} is missing — run \`npm ci\`; this suite links it into a fixture.`,
    );
  }
});

/**
 * The binary, unpacked the way npx unpacks it: `<cache>/node_modules/buildql/dist/cli/bin.js`.
 *
 * The nesting is not decoration. `package.json` is copied alongside it because `bin.js` is
 * ESM and a stray `.js` in a directory with no `"type": "module"` is parsed as CommonJS —
 * a copy placed flat in a temp directory would die on its first `import` statement, and
 * the suite would be testing the layout rather than the resolution. The same file is what
 * `--version` reads, so this also covers the manifest lookup from an installed package
 * rather than only from `src/`.
 */
function unpackedCli(): string {
  const cache = mkTemp('buildql-npx-cache-');
  const pkgDir = join(cache, 'node_modules', 'buildql');
  mkdirSync(join(pkgDir, 'dist', 'cli'), { recursive: true });
  copyFileSync(builtBin, join(pkgDir, 'dist', 'cli', 'bin.js'));
  copyFileSync(fileURLToPath(new URL('package.json', repoRoot)), join(pkgDir, 'package.json'));
  return join(pkgDir, 'dist', 'cli', 'bin.js');
}

/** A project to generate into: a config, an SDL schema, and optionally its own `graphql`. */
function project(opts: { graphql: boolean }): string {
  const dir = mkTemp('buildql-npx-project-');
  copyFileSync(sdlFixture, join(dir, 'schema.graphql'));
  writeFileSync(join(dir, 'buildql.config.mjs'), CONFIG);
  if (opts.graphql) {
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    // Symlinked rather than copied: `graphql` is ~1000 files, and Node resolves the link
    // before loading, so the dependency behaves identically either way.
    symlinkSync(repoGraphql, join(dir, 'node_modules', 'graphql'), 'dir');
  }
  return dir;
}

describe('the CLI run from outside its own install tree (npx / pnpm dlx)', () => {
  it("generates from an SDL schema using the PROJECT's graphql, not its own", async () => {
    const bin = unpackedCli();
    const dir = project({ graphql: true });

    const { stdout } = await execFileAsync(process.execPath, [bin, 'generate'], { cwd: dir });

    expect(stdout).toContain('buildql: wrote');
    const generated = readFileSync(join(dir, 'gql', 'index.ts'), 'utf8');
    expect(generated).toContain('export const Post = {');
  });

  it('still resolves the project graphql when --config points elsewhere', async () => {
    // `--config <dir>` sets the directory buildql treats as the project, and that is the
    // directory the `graphql` lookup must use. Resolving from `process.cwd()` instead would
    // pass the test above (the two are the same there) and break for anyone running
    // `npx buildql generate --config packages/api` from a monorepo root — the exact case
    // the flag exists for. Spawned from a directory with no `graphql` above it so that a
    // cwd-based implementation cannot accidentally succeed.
    const bin = unpackedCli();
    const dir = project({ graphql: true });
    const elsewhere = mkTemp('buildql-npx-elsewhere-');

    const { stdout } = await execFileAsync(process.execPath, [bin, 'generate', '--config', dir], {
      cwd: elsewhere,
    });

    expect(stdout).toContain('buildql: wrote');
    expect(existsSync(join(dir, 'gql', 'index.ts'))).toBe(true);
  });

  it('fails with advice that names the project directory when graphql is nowhere', async () => {
    // The failure still has to be actionable: the old message said "install graphql" without
    // saying WHERE, which under npx is the only part the user cannot guess (alongside the
    // CLI is wrong; alongside the config is right).
    const bin = unpackedCli();
    const dir = project({ graphql: false });

    const failure = await execFileAsync(process.execPath, [bin, 'generate'], { cwd: dir }).then(
      () => undefined,
      (err: { code: number; stderr: string }) => err,
    );

    // Thrown rather than asserted: a CLI that SUCCEEDS here found `graphql` somewhere this
    // suite did not put it, which means the two tests above are passing for the wrong
    // reason and prove nothing about the npx path.
    if (!failure) {
      throw new Error(
        'buildql: the CLI generated without graphql — the npx isolation in this suite is broken',
      );
    }
    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain('"graphql"');
    expect(failure.stderr).toContain(dir);
  });

  it('reports its version from the installed manifest', async () => {
    const bin = unpackedCli();
    const { version } = JSON.parse(readFileSync(new URL('package.json', repoRoot), 'utf8')) as {
      version: string;
    };

    const { stdout } = await execFileAsync(process.execPath, [bin, '--version']);

    expect(stdout).toBe(`${version}\n`);
  });
});
