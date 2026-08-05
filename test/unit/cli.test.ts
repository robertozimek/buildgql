import { expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../../src/cli/index.js';

const sdlPath = fileURLToPath(new URL('../fixtures/schema.graphql', import.meta.url));

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
