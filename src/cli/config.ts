import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isAbsolute, join, resolve } from 'node:path';

export interface BuildQLConfig {
  /** URL, path to an introspection .json, or path to an SDL file. */
  readonly schema: string;
  /** Sent with the introspection request when `schema` is a URL. */
  readonly headers?: Record<string, string>;
  /** Directory for the generated module. Defaults to `./src/gql`. */
  readonly output?: string;
  /** Maps custom GraphQL scalars to TypeScript types, e.g. `{ DateTime: 'string' }`. */
  readonly scalars?: Record<string, string>;
}

export function defineConfig(config: BuildQLConfig): BuildQLConfig {
  return config;
}

const CANDIDATES = ['buildql.config.ts', 'buildql.config.mts', 'buildql.config.mjs', 'buildql.config.js'];

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Narrows a value coming from `typeof config === 'object'` down to a plain BuildQLConfig-shaped record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** True when `value` is a well-formed BuildQLConfig: at minimum a non-empty string `schema`. */
function isBuildQLConfig(value: unknown): value is BuildQLConfig {
  return isRecord(value) && typeof value.schema === 'string' && value.schema.length > 0;
}

export async function loadConfig(cwd: string = process.cwd()): Promise<{ config: BuildQLConfig; path: string }> {
  for (const name of CANDIDATES) {
    const path = join(cwd, name);
    if (!(await exists(path))) continue;

    let mod: unknown;
    try {
      mod = await import(pathToFileURL(path).href);
    } catch (err) {
      if (name.endsWith('.ts') || name.endsWith('.mts')) {
        throw new Error(
          `buildql: could not load ${name}. Node must be able to run TypeScript directly ` +
            `(Node >= 22.6 with --experimental-strip-types, or Node >= 23.6). ` +
            `Otherwise rename it to buildql.config.mjs. Original error: ${(err as Error).message}`,
        );
      }
      throw err;
    }

    if (!isRecord(mod) || !('default' in mod)) {
      throw new Error(`buildql: ${name} must have a default export`);
    }
    const config = mod.default;
    if (!isRecord(config)) {
      throw new Error(`buildql: ${name}'s default export must be an object (use defineConfig({...}))`);
    }
    if (!isBuildQLConfig(config)) {
      throw new Error(`buildql: ${name} is missing "schema" — set it to a URL, a .json, or a .graphql file`);
    }
    return { config, path };
  }
  throw new Error(
    `buildql: no config found in ${cwd}. Create a buildql.config.ts (or .js) exporting ` +
      `defineConfig({ schema: 'https://...' | './schema.graphql' }).`,
  );
}

export function resolveOutputDir(config: BuildQLConfig, cwd: string): string {
  const out = config.output ?? './src/gql';
  return isAbsolute(out) ? out : resolve(cwd, out);
}
