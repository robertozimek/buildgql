import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, loadConfig } from '../../src/cli/config.js';

describe('defineConfig', () => {
  it('returns its input unchanged', () => {
    const c = { schema: './schema.graphql' };
    expect(defineConfig(c)).toEqual(c);
  });
});

describe('loadConfig', () => {
  it('loads buildql.config.mjs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(
      join(dir, 'buildql.config.mjs'),
      "export default { schema: './schema.graphql', output: './gen' };\n",
    );
    const { config, path } = await loadConfig(dir);
    expect(config.schema).toBe('./schema.graphql');
    expect(config.output).toBe('./gen');
    expect(path).toContain('buildql.config.mjs');
  });

  it('errors clearly when no config exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await expect(loadConfig(dir)).rejects.toThrow(/buildql\.config\.(ts|js)/);
  });

  it('errors clearly when schema is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(join(dir, 'buildql.config.mjs'), 'export default {};\n');
    await expect(loadConfig(dir)).rejects.toThrow(/"schema"/);
  });

  it('errors clearly when the default export is not an object', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(join(dir, 'buildql.config.mjs'), "export default './schema.graphql';\n");
    await expect(loadConfig(dir)).rejects.toThrow(/buildql:.*default export must be an object/);
  });

  it('errors clearly when schema is not a string', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(join(dir, 'buildql.config.mjs'), 'export default { schema: 42 };\n');
    await expect(loadConfig(dir)).rejects.toThrow(/"schema"/);
  });
});
