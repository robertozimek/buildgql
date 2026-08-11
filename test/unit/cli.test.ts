import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../../src/cli/generate.js';
import { main } from '../../src/cli/main.js';
import { collectingReporter } from '../../src/cli/reporter.js';

const sdlPath = fileURLToPath(new URL('../fixtures/schema.graphql', import.meta.url));

// main() writes usage/status text to the real stdout/stderr; spy on both so the test
// run's own output stays pristine, and restore them after every test.
function spyOnWrite(stream: NodeJS.WriteStream) {
  return vi.spyOn(stream, 'write').mockImplementation(() => true);
}
type WriteSpy = ReturnType<typeof spyOnWrite>;
let stdoutSpy: WriteSpy;
let stderrSpy: WriteSpy;

beforeEach(() => {
  stdoutSpy = spyOnWrite(process.stdout);
  stderrSpy = spyOnWrite(process.stderr);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

function written(spy: WriteSpy): string {
  return spy.mock.calls.map((call) => String(call[0])).join('');
}

it('generates a file at the configured output path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildgql-cli-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  const out = await generate({ schema: './schema.graphql', output: './src/gql' }, dir);
  expect(out).toBe(join(dir, 'src/gql/index.ts'));
  const src = await readFile(out, 'utf8');
  expect(src).toContain('export const Post = {');
  expect(src).toContain('export const query = makeQuery(Query)');
});

it('applies scalar overrides from config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildgql-cli-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  const out = await generate({ schema: './schema.graphql', scalars: { ID: 'MyId' } }, dir);
  expect(await readFile(out, 'utf8')).toContain("leafField<'id', ['!'], MyId>");
});

it('rewrites a config-relative scalar import against the output directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildgql-cli-'));
  await writeFile(join(dir, 'schema.graphql'), await readFile(sdlPath, 'utf8'));
  const out = await generate(
    {
      schema: './schema.graphql',
      output: './src/gql',
      scalars: { ID: { name: 'PostId', from: './src/types/ids' } },
    },
    dir,
  );
  // `from` is written against the config file; the generated module lives two levels deeper.
  expect(await readFile(out, 'utf8')).toContain("import type { PostId } from '../types/ids';");
});

it('leaves a package specifier alone, so a published generated module still resolves it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildgql-cli-'));
  await writeFile(join(dir, 'schema.graphql'), await readFile(sdlPath, 'utf8'));
  const out = await generate(
    {
      schema: './schema.graphql',
      output: './src/gql',
      scalars: { ID: { name: 'JsonValue', from: '@myorg/domain-types' } },
    },
    dir,
  );
  expect(await readFile(out, 'utf8')).toContain("import type { JsonValue } from '@myorg/domain-types';");
});

it('tells the user which type modules the generated module now imports from', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildgql-cli-'));
  await writeFile(join(dir, 'schema.graphql'), await readFile(sdlPath, 'utf8'));
  const reporter = collectingReporter();
  await generate(
    { schema: './schema.graphql', output: '.', scalars: { ID: { name: 'PostId', from: './ids' } } },
    dir,
    reporter,
  );
  expect(reporter.infos.join('\n')).toContain('./ids');
});

it('says nothing about scalar imports when no scalar declares one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildgql-cli-'));
  await writeFile(join(dir, 'schema.graphql'), await readFile(sdlPath, 'utf8'));
  const reporter = collectingReporter();
  await generate({ schema: './schema.graphql', output: '.', scalars: { ID: 'string' } }, dir, reporter);
  expect(reporter.infos.join('\n')).not.toContain('import');
});

it('warns by name about a custom scalar with no entry in "scalars"', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildgql-cli-'));
  await writeFile(join(dir, 'schema.graphql'), 'scalar DateTime\n\ntype Query {\n  now: DateTime!\n}\n');

  await generate({ schema: './schema.graphql' }, dir);

  expect(written(stderrSpy)).toContain('buildgql: unmapped custom scalar');
  expect(written(stderrSpy)).toContain('DateTime');
});

it('does not warn once the scalar is mapped in config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildgql-cli-'));
  await writeFile(join(dir, 'schema.graphql'), 'scalar DateTime\n\ntype Query {\n  now: DateTime!\n}\n');

  await generate({ schema: './schema.graphql', scalars: { DateTime: 'string' } }, dir);

  expect(written(stderrSpy)).not.toContain('unmapped custom scalar');
});

it('main() with no args returns 1 and prints usage', async () => {
  const code = await main([]);
  expect(code).toBe(1);
  expect(written(stdoutSpy)).toContain('Usage:');
});

it('main() --help returns 0 and prints usage', async () => {
  const code = await main(['--help']);
  expect(code).toBe(0);
  expect(written(stdoutSpy)).toContain('Usage:');
});

it('main() --version prints the manifest version and nothing else', async () => {
  // Compared against the manifest rather than a literal, so bumping the version does not
  // break the test — and so a `version()` that read the WRONG package.json (its own
  // dependency's, say, if the relative path drifted) fails here instead of shipping a
  // number that has nothing to do with buildgql.
  const manifest = JSON.parse(
    await readFile(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
  ) as { version: string };

  const code = await main(['--version']);
  expect(code).toBe(0);
  // Exact, not `toContain`: `buildgql --version` is the sort of thing a script pipes
  // somewhere, and usage text or a banner mixed into that output would break it silently.
  expect(written(stdoutSpy)).toBe(`${manifest.version}\n`);
});

it('main() with an unknown command returns 1', async () => {
  const code = await main(['bogus']);
  expect(code).toBe(1);
  expect(written(stderrSpy)).toContain('unknown command "bogus"');
});

it('main() generate returns 0 and writes the file when config is valid', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildgql-cli-main-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  await writeFile(join(dir, 'buildgql.config.mjs'), "export default { schema: './schema.graphql' };\n");

  const code = await main(['generate', '--config', dir]);

  expect(code).toBe(0);
  const out = join(dir, 'src/gql/index.ts');
  const src = await readFile(out, 'utf8');
  expect(src).toContain('export const Post = {');
  expect(written(stdoutSpy)).toContain(`wrote ${out}`);
});

it('main() generate returns 1 without throwing when no config is present', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildgql-cli-main-'));

  const code = await main(['generate', '--config', dir]);

  expect(code).toBe(1);
  expect(written(stderrSpy)).toContain('buildgql: no config found');
});

it('prefixes a raw, non-buildgql error before it reaches the reporter', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildgql-cli-main-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  // A plain FILE sits where the output path needs an intermediate DIRECTORY, so
  // `mkdir(..., { recursive: true })` inside generate() fails with a raw ENOTDIR — a real
  // Node fs error, not one of buildgql's own `throw new Error('buildgql: ...')` calls.
  await writeFile(join(dir, 'blocker'), '');
  await writeFile(
    join(dir, 'buildgql.config.mjs'),
    "export default { schema: './schema.graphql', output: './blocker/nested' };\n",
  );
  const reporter = collectingReporter();

  const code = await main(['generate', '--config', dir], reporter);

  expect(code).toBe(1);
  expect(reporter.warns).toHaveLength(1);
  expect(reporter.warns[0]).toMatch(/^buildgql: /);
  // Proves this really is the unwrapped fs error being prefixed, not a coincidence: no
  // `buildgql: ...` message anywhere in the codebase mentions ENOTDIR.
  expect(reporter.warns[0]).toContain('ENOTDIR');
});

it('generates a module bound to the configured client', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildgql-cli-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  const out = await generate({ schema: './schema.graphql', output: '.', client: 'urql' }, dir);
  const src = await readFile(out, 'utf8');
  expect(src).toContain("import { toUrqlArgs, urqlDocument } from 'buildgql/adapters/urql';");
  expect(src).not.toContain('createClient');
});

it('tells the user which adapter names the generated module now re-exports', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildgql-cli-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  await generate({ schema: './schema.graphql', output: '.', client: 'apollo' }, dir);
  expect(written(stdoutSpy)).toMatch(
    /buildgql: client "apollo" — the generated module re-exports apolloDocument, toApolloMutation, toApolloQuery from buildgql\/adapters\/apollo \(requires the "graphql" package\)/,
  );
});

it('says nothing about adapters for the default client', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildgql-cli-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  await generate({ schema: './schema.graphql', output: '.' }, dir);
  expect(written(stdoutSpy)).not.toContain('buildgql/adapters');
});

it('reports unmapped scalars through the injected reporter, not the console', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildgql-cli-'));
  await writeFile(join(dir, 'schema.graphql'), 'scalar DateTime\n\ntype Query {\n  now: DateTime!\n}\n');
  const reporter = collectingReporter();

  await generate({ schema: './schema.graphql', output: '.' }, dir, reporter);

  expect(reporter.warns.join('\n')).toContain('unmapped custom scalar');
  expect(reporter.warns.join('\n')).toContain('DateTime');
  expect(written(stderrSpy)).toBe('');
});
