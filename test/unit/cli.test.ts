import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, copyFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generate, isEntrypoint, main } from '../../src/cli/index.js';

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
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  const out = await generate({ schema: './schema.graphql', output: './src/gql' }, dir);
  expect(out).toBe(join(dir, 'src/gql/index.ts'));
  const src = await readFile(out, 'utf8');
  expect(src).toContain('export const Post = {');
  expect(src).toContain('export const query = makeQuery(Query)');
});

it('applies scalar overrides from config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  const out = await generate({ schema: './schema.graphql', scalars: { ID: 'MyId' } }, dir);
  expect(await readFile(out, 'utf8')).toContain("leaf<'id', ['!'], MyId>");
});

it('warns by name about a custom scalar with no entry in "scalars"', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-'));
  await writeFile(
    join(dir, 'schema.graphql'),
    'scalar DateTime\n\ntype Query {\n  now: DateTime!\n}\n',
  );

  await generate({ schema: './schema.graphql' }, dir);

  expect(written(stderrSpy)).toContain('buildql: unmapped custom scalar');
  expect(written(stderrSpy)).toContain('DateTime');
});

it('does not warn once the scalar is mapped in config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-'));
  await writeFile(
    join(dir, 'schema.graphql'),
    'scalar DateTime\n\ntype Query {\n  now: DateTime!\n}\n',
  );

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

it('main() with an unknown command returns 1', async () => {
  const code = await main(['bogus']);
  expect(code).toBe(1);
  expect(written(stderrSpy)).toContain('unknown command "bogus"');
});

it('main() generate returns 0 and writes the file when config is valid', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-main-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  await writeFile(join(dir, 'buildql.config.mjs'), "export default { schema: './schema.graphql' };\n");

  const code = await main(['generate', '--config', dir]);

  expect(code).toBe(0);
  const out = join(dir, 'src/gql/index.ts');
  const src = await readFile(out, 'utf8');
  expect(src).toContain('export const Post = {');
  expect(written(stdoutSpy)).toContain(`wrote ${out}`);
});

it('main() generate returns 1 without throwing when no config is present', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-main-'));

  const code = await main(['generate', '--config', dir]);

  expect(code).toBe(1);
  expect(written(stderrSpy)).toContain('buildql: no config found');
});

it('generates a module bound to the configured client', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  const out = await generate({ schema: './schema.graphql', output: '.', client: 'urql' }, dir);
  const src = await readFile(out, 'utf8');
  expect(src).toContain("import { toUrqlArgs, urqlDocument } from 'buildql/adapters/urql';");
  expect(src).not.toContain('createClient');
});

it('tells the user which adapter names the generated module now re-exports', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  await generate({ schema: './schema.graphql', output: '.', client: 'apollo' }, dir);
  expect(written(stdoutSpy)).toMatch(
    /buildql: client "apollo" — the generated module re-exports apolloDocument, toApolloMutation, toApolloQuery from buildql\/adapters\/apollo \(requires the "graphql" package\)/,
  );
});

it('says nothing about adapters for the default client', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  await generate({ schema: './schema.graphql', output: '.' }, dir);
  expect(written(stdoutSpy)).not.toContain('buildql/adapters');
});

// The CLI only calls `main()` when it decides it was invoked as the binary rather than
// imported. Getting that decision wrong is silent: the process exits 0 having done
// nothing, which looks exactly like a successful `buildql generate`.
it('recognises a SYMLINKED entrypoint as the entrypoint', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-entry-'));
  const real = join(dir, 'real-cli.js');
  await writeFile(real, '// stands in for dist/cli/index.js\n');
  const link = join(dir, 'linked-cli.js');
  await symlink(real, link);

  // Node resolves `import.meta.url` to the file's REALPATH, while `process.argv[1]`
  // keeps whatever path the caller typed. pnpm (by default), npm workspaces and
  // `npm link` all install `node_modules/buildql` as a symlink, so comparing the two
  // raw strings is false for every one of those users — the exact condition that made
  // `buildql generate` a silent no-op under pnpm.
  expect(isEntrypoint(pathToFileURL(real).href, link)).toBe(true);
});

it('recognises a plain, unsymlinked entrypoint', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-entry-'));
  const real = join(dir, 'cli.js');
  await writeFile(real, '// cli\n');
  expect(isEntrypoint(pathToFileURL(real).href, real)).toBe(true);
});

it('rejects an unrelated entrypoint, so importing the module does not run it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-entry-'));
  const a = join(dir, 'cli.js');
  const b = join(dir, 'some-test-runner.js');
  await writeFile(a, '// cli\n');
  await writeFile(b, '// runner\n');
  expect(isEntrypoint(pathToFileURL(a).href, b)).toBe(false);
});

it('rejects a missing argv[1] rather than throwing', () => {
  expect(isEntrypoint('file:///anything.js', undefined)).toBe(false);
  // A path that does not exist must not blow up `realpathSync` on the way through.
  expect(isEntrypoint('file:///anything.js', '/no/such/file.js')).toBe(false);
});
