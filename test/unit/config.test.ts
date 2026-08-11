import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig, loadConfig } from '../../src/cli/config.js';
import type { ConfigImporter } from '../../src/cli/config.js';

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

  it('errors clearly when output is not a string', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(
      join(dir, 'buildql.config.mjs'),
      "export default { schema: './schema.graphql', output: 42 };\n",
    );
    await expect(loadConfig(dir)).rejects.toThrow(/buildql:.*"output"/);
  });

  it('errors clearly when headers is not a string record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(
      join(dir, 'buildql.config.mjs'),
      "export default { schema: './schema.graphql', headers: { Authorization: 42 } };\n",
    );
    await expect(loadConfig(dir)).rejects.toThrow(/buildql:.*"headers"/);
  });

  it('errors clearly when a scalars entry is neither a string nor an object', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(
      join(dir, 'buildql.config.mjs'),
      "export default { schema: './schema.graphql', scalars: { DateTime: 42 } };\n",
    );
    await expect(loadConfig(dir)).rejects.toThrow(/buildql:.*"scalars\.DateTime"/);
  });

  /** Writes `source` as the default export of a buildql.config.mjs in a fresh temp dir. */
  async function configDir(source: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(
      join(dir, 'buildql.config.mjs'),
      `export default { schema: './s.graphql', ${source} };\n`,
    );
    return dir;
  }

  it('accepts the object form of a scalars entry', async () => {
    const dir = await configDir(
      "scalars: { Money: { name: 'Money', from: './src/types/money' }, DateTime: { input: 'string | Date', output: 'string' }, Plain: 'string' }",
    );
    const { config } = await loadConfig(dir);
    expect(config.scalars).toEqual({
      Money: { name: 'Money', from: './src/types/money' },
      DateTime: { input: 'string | Date', output: 'string' },
      Plain: 'string',
    });
  });

  it('rejects an empty string scalars entry', async () => {
    const dir = await configDir("scalars: { DateTime: '' }");
    await expect(loadConfig(dir)).rejects.toThrow(/"scalars\.DateTime".*empty/);
  });

  it('rejects an unknown key, so a typo does not silently do nothing', async () => {
    const dir = await configDir("scalars: { DateTime: { ouput: 'string' } }");
    await expect(loadConfig(dir)).rejects.toThrow(/unknown key "ouput"/);
  });

  it('rejects "from" and "declare" together', async () => {
    const dir = await configDir("scalars: { J: { name: 'J', from: 'pkg', declare: 'string' } }");
    await expect(loadConfig(dir)).rejects.toThrow(/both "from" and "declare"/);
  });

  it('rejects a "name" that is not a valid TypeScript identifier', async () => {
    const dir = await configDir("scalars: { J: { name: 'my type', from: 'pkg' } }");
    await expect(loadConfig(dir)).rejects.toThrow(/"scalars\.J\.name" \("my type"\) is not a valid/);
  });

  it('rejects "name" without "from" or "declare", which would declare nothing', async () => {
    const dir = await configDir("scalars: { J: { name: 'J' } }");
    await expect(loadConfig(dir)).rejects.toThrow(/neither "from" nor "declare"/);
  });

  it('rejects an empty scalars object entry', async () => {
    const dir = await configDir('scalars: { J: {} }');
    await expect(loadConfig(dir)).rejects.toThrow(/"scalars\.J" is empty/);
  });

  it('rejects "from" without "name", which would leave nothing to refer to the imported type by', async () => {
    const dir = await configDir("scalars: { J: { from: 'pkg' } }");
    await expect(loadConfig(dir)).rejects.toThrow(/"scalars\.J".*"name"/);
  });

  it('rejects a non-string "from"', async () => {
    const dir = await configDir("scalars: { J: { name: 'J', from: 42 } }");
    await expect(loadConfig(dir)).rejects.toThrow(/"scalars\.J\.from" must be a non-empty string/);
  });

  it('rejects an array scalars entry, which Object.entries would otherwise walk', async () => {
    const dir = await configDir("scalars: { J: ['string'] }");
    await expect(loadConfig(dir)).rejects.toThrow(/"scalars\.J"/);
  });

  it('rejects a "from" containing a single quote, which would break out of the emitted string literal', async () => {
    const dir = await configDir(`scalars: { J: { name: 'J', from: "./Bob's types/money" } }`);
    await expect(loadConfig(dir)).rejects.toThrow(/"scalars\.J\.from"/);
  });

  it('rejects a "from" containing a newline, which would break out of the emitted string literal', async () => {
    const dir = await configDir("scalars: { J: { name: 'J', from: 'a\\nb' } }");
    await expect(loadConfig(dir)).rejects.toThrow(/"scalars\.J\.from"/);
  });

  it('accepts an ordinary relative-path "from"', async () => {
    const dir = await configDir("scalars: { J: { name: 'J', from: './src/types/money' } }");
    const { config } = await loadConfig(dir);
    expect(config.scalars).toEqual({ J: { name: 'J', from: './src/types/money' } });
  });

  it('accepts a scoped package "from"', async () => {
    const dir = await configDir("scalars: { J: { name: 'J', from: '@myorg/types' } }");
    const { config } = await loadConfig(dir);
    expect(config.scalars).toEqual({ J: { name: 'J', from: '@myorg/types' } });
  });

  it('rejects "name: \'default\'", which would emit an invalid import binding', async () => {
    const dir = await configDir("scalars: { J: { name: 'default', from: 'pkg' } }");
    await expect(loadConfig(dir)).rejects.toThrow(/"scalars\.J\.name" \("default"\) is a reserved word/);
  });

  it('rejects "name: \'string\'", which cannot be redeclared as a type alias', async () => {
    const dir = await configDir("scalars: { J: { name: 'string', declare: 'number' } }");
    await expect(loadConfig(dir)).rejects.toThrow(/"scalars\.J\.name" \("string"\) is a reserved word/);
  });

  it('rejects "name: \'as\'", which would emit an invalid type alias ("export type as = ...")', async () => {
    const dir = await configDir("scalars: { J: { name: 'as', declare: 'Foo' } }");
    await expect(loadConfig(dir)).rejects.toThrow(/buildql:.*"scalars\.J\.name" \("as"\) is a reserved word/);
  });

  it('accepts an ordinary "name"', async () => {
    const dir = await configDir("scalars: { J: { name: 'Money', from: 'pkg' } }");
    const { config } = await loadConfig(dir);
    expect(config.scalars).toEqual({ J: { name: 'Money', from: 'pkg' } });
  });

  it("surfaces the config module's own error instead of TypeScript-support advice", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(join(dir, 'buildql.config.mjs'), "throw new Error('boom: DATABASE_URL is not set');\n");
    await expect(loadConfig(dir)).rejects.toThrow(/boom: DATABASE_URL is not set/);
    await expect(loadConfig(dir)).rejects.not.toThrow(/Node must be able to run TypeScript directly/);
  });

  /**
   * Reproducing "this Node can't load a `.ts` config" for real means an actual Node
   * `import()` rejecting with a native `SyntaxError` (Node >= 22.6 without
   * `--experimental-transform-types`) or `ERR_UNKNOWN_FILE_EXTENSION` (no native TS
   * support at all). Vitest's own transform pipeline handles arbitrary TypeScript
   * (including syntax Node's strip-only mode rejects, e.g. `enum`) and — for genuine
   * parse failures — throws a plain, non-`Error` object of its own shape, so neither
   * case can be reproduced by actually feeding a broken `.ts` file through the test
   * runner's dynamic `import()`. `loadConfig`'s optional `importModule` parameter
   * exists for exactly this: it lets these tests inject the *real* error shapes Node
   * throws for the `.ts` candidate while every other candidate still goes through a
   * real dynamic `import()` against the real filesystem.
   */
  function importModuleThrowingFor(brokenPath: string, err: unknown): ConfigImporter {
    // `err` is deliberately not always an `Error`; see the doc comment above about
    // reproducing the real, non-`Error`-shaped rejections Node and Vitest's transform
    // pipeline throw.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    return (url) => (url === pathToFileURL(brokenPath).href ? Promise.reject(err) : import(url));
  }

  it('falls through to buildql.config.mjs when buildql.config.ts fails with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX (strip-only mode, non-erasable syntax)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    const tsPath = join(dir, 'buildql.config.ts');
    await writeFile(tsPath, "export default { schema: './unused.graphql' };\n");
    await writeFile(
      join(dir, 'buildql.config.mjs'),
      "export default { schema: './schema.graphql', output: './gen' };\n",
    );

    const err = Object.assign(new SyntaxError('TypeScript enum is not supported in strip-only mode'), {
      code: 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
    });
    const { config, path } = await loadConfig(dir, importModuleThrowingFor(tsPath, err));

    expect(config.schema).toBe('./schema.graphql');
    expect(config.output).toBe('./gen');
    expect(path).toContain('buildql.config.mjs');
  });

  it('does NOT fall through — and surfaces the real error — when a .ts config has a genuine syntax error (a bare SyntaxError with no Node error code), even when a valid .mjs is also present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    const tsPath = join(dir, 'buildql.config.ts');
    await writeFile(tsPath, "export default { schema: './unused.graphql' };\n");
    await writeFile(
      join(dir, 'buildql.config.mjs'),
      "export default { schema: './should-not-be-used.graphql' };\n",
    );

    await expect(
      loadConfig(dir, importModuleThrowingFor(tsPath, new SyntaxError("Unexpected token ')'"))),
    ).rejects.toThrow(/Unexpected token/);
  });

  it('falls through to buildql.config.mjs when buildql.config.ts fails with ERR_UNKNOWN_FILE_EXTENSION (no native TS support at all)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    const tsPath = join(dir, 'buildql.config.ts');
    await writeFile(tsPath, "export default { schema: './unused.graphql' };\n");
    await writeFile(join(dir, 'buildql.config.mjs'), "export default { schema: './schema.graphql' };\n");

    const err = Object.assign(new Error('Unknown file extension ".ts"'), {
      code: 'ERR_UNKNOWN_FILE_EXTENSION',
    });
    const { config, path } = await loadConfig(dir, importModuleThrowingFor(tsPath, err));

    expect(config.schema).toBe('./schema.graphql');
    expect(path).toContain('buildql.config.mjs');
  });

  it('writes a stderr line naming the skipped file at the moment it is skipped, not deferred', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    const tsPath = join(dir, 'buildql.config.ts');
    await writeFile(tsPath, "export default { schema: './unused.graphql' };\n");
    await writeFile(join(dir, 'buildql.config.mjs'), "export default { schema: './schema.graphql' };\n");

    const err = Object.assign(new Error('Unknown file extension ".ts"'), {
      code: 'ERR_UNKNOWN_FILE_EXTENSION',
    });
    // `vi.spyOn(process.stderr, 'write')` does not reliably observe writes made through
    // `process.stderr.write` inside this codebase's own modules under Vitest's runner
    // (the stream's `write` is not a plain own property), so intercept with a direct
    // reassignment instead — restored in `finally` regardless of outcome.
    const original = process.stderr.write.bind(process.stderr);
    const calls: string[] = [];
    process.stderr.write = ((chunk: string | Uint8Array) => {
      calls.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      await loadConfig(dir, importModuleThrowingFor(tsPath, err));
    } finally {
      process.stderr.write = original;
    }

    const written = calls.join('');
    expect(written).toContain('buildql.config.ts');
    expect(written).toMatch(/skip/i);
  });

  it('throws the TypeScript-support error when the only config present cannot be loaded on this Node', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    const tsPath = join(dir, 'buildql.config.ts');
    await writeFile(tsPath, "export default { schema: './unused.graphql' };\n");

    const err = Object.assign(new Error('Unknown file extension ".ts"'), {
      code: 'ERR_UNKNOWN_FILE_EXTENSION',
    });
    await expect(loadConfig(dir, importModuleThrowingFor(tsPath, err))).rejects.toThrow(
      /Node must be able to run TypeScript directly/,
    );
  });

  it('does NOT fall through — and surfaces the real error — when a .ts config throws its own runtime error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    const tsPath = join(dir, 'buildql.config.ts');
    await writeFile(tsPath, "export default { schema: './unused.graphql' };\n");
    await writeFile(
      join(dir, 'buildql.config.mjs'),
      "export default { schema: './should-not-be-used.graphql' };\n",
    );

    await expect(
      loadConfig(dir, importModuleThrowingFor(tsPath, new Error('boom: DATABASE_URL is not set'))),
    ).rejects.toThrow(/boom: DATABASE_URL is not set/);
  });

  it('accepts a valid client', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(
      join(dir, 'buildql.config.mjs'),
      "export default { schema: './schema.graphql', client: 'apollo' };\n",
    );
    const { config } = await loadConfig(dir);
    expect(config.client).toBe('apollo');
  });

  it('leaves client undefined when it is not set', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(join(dir, 'buildql.config.mjs'), "export default { schema: './schema.graphql' };\n");
    const { config } = await loadConfig(dir);
    expect(config.client).toBeUndefined();
  });

  it('errors clearly on an unknown client, naming the valid values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(
      join(dir, 'buildql.config.mjs'),
      "export default { schema: './schema.graphql', client: 'relay' };\n",
    );
    await expect(loadConfig(dir)).rejects.toThrow(
      /buildql:.*"client" must be one of "buildql", "apollo", "urql", "none"/,
    );
  });

  it('errors clearly when client is not a string', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(
      join(dir, 'buildql.config.mjs'),
      "export default { schema: './schema.graphql', client: 42 };\n",
    );
    await expect(loadConfig(dir)).rejects.toThrow(/buildql:.*"client"/);
  });
});
