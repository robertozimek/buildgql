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

// ESM-first, legacy last: prefer native TS/ESM config formats and fall back to plain .js only
// when nothing else is present.
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

/** True when every own value of `value` is a string (used for the `headers`/`scalars` maps). */
function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === 'string');
}

/** Extracts a readable message from a caught `unknown` without assuming it's an `Error`. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * True when `err` looks like Node rejected the import specifically because it lacks native
 * TypeScript support, as opposed to the user's config throwing its own runtime error.
 */
function isMissingTypeStrippingSupport(err: unknown): boolean {
  if (err instanceof SyntaxError) return true;
  return isRecord(err) && err.code === 'ERR_UNKNOWN_FILE_EXTENSION';
}

/**
 * Throws a field-specific `buildql:`-prefixed error unless `value` is a well-formed
 * BuildQLConfig: a non-empty string `schema`, and — when present — a string `output` and
 * string-valued `headers`/`scalars` records.
 */
function assertBuildQLConfig(
  name: string,
  value: Record<string, unknown>,
): asserts value is Record<string, unknown> & BuildQLConfig {
  if (typeof value.schema !== 'string' || value.schema.length === 0) {
    throw new Error(`buildql: ${name} is missing "schema" — set it to a URL, a .json, or a .graphql file`);
  }
  if (value.output !== undefined && typeof value.output !== 'string') {
    throw new Error(`buildql: ${name}'s "output" must be a string path`);
  }
  if (value.headers !== undefined && !isStringRecord(value.headers)) {
    throw new Error(`buildql: ${name}'s "headers" must be a record of string values`);
  }
  if (value.scalars !== undefined && !isStringRecord(value.scalars)) {
    throw new Error(`buildql: ${name}'s "scalars" must be a record of string values`);
  }
}

/** Loads an ES module given its `file:` URL. Overridable in tests only — see `loadConfig`. */
export type ConfigImporter = (url: string) => Promise<unknown>;

const defaultImporter: ConfigImporter = (url) => import(url);

export async function loadConfig(
  cwd: string = process.cwd(),
  // Exposed purely as a test seam: exercising the "this Node can't load a `.ts`
  // config" fallthrough for real requires an actual Node import to reject with a
  // native `SyntaxError`/`ERR_UNKNOWN_FILE_EXTENSION`, which a TypeScript-aware test
  // runner's own transform (unlike plain Node) won't reproduce. Production code never
  // passes this — `cli/index.ts` calls `loadConfig(cwd)` — so real dynamic `import()`
  // is always what actually resolves a config file outside of tests.
  importModule: ConfigImporter = defaultImporter,
): Promise<{ config: BuildQLConfig; path: string }> {
  // When a `.ts`/`.mts` candidate exists but fails to load specifically because this
  // Node lacks native TypeScript support, that candidate is skipped rather than
  // treated as fatal — a project that also ships a working `buildql.config.mjs` (or
  // `.js`) must still work on Node 20. The message is remembered so it can still be
  // shown if nothing else loads either.
  let missingTypeStrippingMessage: string | undefined;

  for (const name of CANDIDATES) {
    const path = join(cwd, name);
    if (!(await exists(path))) continue;

    let mod: unknown;
    try {
      mod = await importModule(pathToFileURL(path).href);
    } catch (err) {
      if ((name.endsWith('.ts') || name.endsWith('.mts')) && isMissingTypeStrippingSupport(err)) {
        missingTypeStrippingMessage = `buildql: could not load ${name}. Node must be able to run TypeScript directly ` +
          `(Node >= 22.6 with --experimental-strip-types, or Node >= 23.6). ` +
          `Otherwise rename it to buildql.config.mjs. Original error: ${errorMessage(err)}`;
        continue;
      }
      throw new Error(`buildql: failed to load ${name}: ${errorMessage(err)}`);
    }

    if (!isRecord(mod) || !('default' in mod)) {
      throw new Error(`buildql: ${name} must have a default export`);
    }
    const config = mod.default;
    if (!isRecord(config)) {
      throw new Error(`buildql: ${name}'s default export must be an object (use defineConfig({...}))`);
    }
    assertBuildQLConfig(name, config);
    return { config, path };
  }
  if (missingTypeStrippingMessage) {
    throw new Error(missingTypeStrippingMessage);
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
