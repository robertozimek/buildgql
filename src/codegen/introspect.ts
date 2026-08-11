import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type * as GraphqlModule from 'graphql';

export interface IntrospectionTypeRef {
  readonly kind: string;
  readonly name: string | null;
  readonly ofType: IntrospectionTypeRef | null;
}

export interface IntrospectionInputValue {
  readonly name: string;
  readonly type: IntrospectionTypeRef;
  readonly defaultValue: string | null;
}

export interface IntrospectionField {
  readonly name: string;
  readonly description: string | null;
  readonly args: readonly IntrospectionInputValue[];
  readonly type: IntrospectionTypeRef;
  readonly isDeprecated: boolean;
  readonly deprecationReason: string | null;
}

export interface IntrospectionType {
  readonly kind: string;
  readonly name: string;
  readonly description: string | null;
  readonly fields: readonly IntrospectionField[] | null;
  readonly inputFields: readonly IntrospectionInputValue[] | null;
  readonly interfaces: readonly IntrospectionTypeRef[] | null;
  readonly enumValues: readonly { name: string; description: string | null }[] | null;
  readonly possibleTypes: readonly IntrospectionTypeRef[] | null;
}

export interface IntrospectionResult {
  readonly __schema: {
    readonly queryType: { name: string };
    readonly mutationType: { name: string } | null;
    readonly subscriptionType: { name: string } | null;
    readonly types: readonly IntrospectionType[];
  };
}

function isIntrospectionResult(value: unknown): value is IntrospectionResult {
  return typeof value === 'object' && value !== null && '__schema' in value;
}

const TYPE_REF = `
  kind name
  ofType { kind name
    ofType { kind name
      ofType { kind name
        ofType { kind name
          ofType { kind name
            ofType { kind name } } } } } }
`;

export const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        args { name type { ${TYPE_REF} } defaultValue }
        type { ${TYPE_REF} }
        isDeprecated
        deprecationReason
      }
      inputFields { name type { ${TYPE_REF} } defaultValue }
      interfaces { ${TYPE_REF} }
      enumValues(includeDeprecated: true) { name description }
      possibleTypes { ${TYPE_REF} }
    }
  }
}`.replace(/\s+/g, ' ');

export interface LoadOptions {
  /** `| undefined` is explicit: callers forward a possibly-absent `config.headers` directly. */
  readonly headers?: Record<string, string> | undefined;
  readonly fetch?: typeof fetch;
  /**
   * The project directory to resolve the optional `graphql` peer from when it is not
   * resolvable from buildql itself. See `importGraphql` — this exists for `npx`/`dlx`.
   */
  readonly cwd?: string | undefined;
}

async function introspectUrl(url: string, opts: LoadOptions): Promise<IntrospectionResult> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(opts.headers ?? {}) },
    body: JSON.stringify({ query: INTROSPECTION_QUERY, operationName: 'IntrospectionQuery' }),
  });
  if (!res.ok) {
    throw new Error(`buildql: introspection of ${url} failed with HTTP ${res.status}`);
  }
  // Read the body ONCE as text and parse it by hand — a proxy or misconfigured server
  // can return an HTML error page with a 200 status, and calling `res.json()` directly
  // would surface that as a raw, unhelpful `SyntaxError` instead of a clear message.
  const raw = await res.text();
  let payload: { data?: IntrospectionResult; errors?: { message: string }[] };
  try {
    payload = JSON.parse(raw) as { data?: IntrospectionResult; errors?: { message: string }[] };
  } catch {
    throw new Error(`buildql: introspection of ${url} did not return valid JSON: ${raw.slice(0, 200)}`);
  }
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(
      `buildql: introspection of ${url} failed: ${payload.errors.map((e) => e.message).join('; ')}`,
    );
  }
  if (!payload.data?.__schema) {
    throw new Error(`buildql: introspection of ${url} returned no __schema`);
  }
  return payload.data;
}

/** The three members `introspectSdl` uses — checked, because the fallback below is untyped. */
function isGraphqlModule(value: unknown): value is typeof GraphqlModule {
  if (typeof value !== 'object' || value === null) return false;
  const mod = value as Record<string, unknown>;
  return ['buildSchema', 'parse', 'executeSync'].every((name) => typeof mod[name] === 'function');
}

/**
 * The optional `graphql` peer, resolved from buildql first and from the user's project
 * second.
 *
 * The second half exists for `npx buildql` / `pnpm dlx buildql`, which is how most people
 * will run the CLI the first time. Under npx the binary lives in a throwaway cache
 * directory (`~/.npm/_npx/<hash>/node_modules/buildql/dist/cli/bin.js`), and Node resolves
 * a bare specifier by walking up from the IMPORTING file — so `import('graphql')` searches
 * the npx cache and stops there. npm does not install optional peers, so it never finds
 * one, and the project's own `graphql` two directories away in the user's cwd is invisible
 * to it. Every SDL-schema user would hit "install graphql" for a package they already have
 * installed, with no way to act on the advice.
 *
 * `createRequire` re-roots resolution at the project instead. Its argument is a REFERRER
 * file, not a directory, and need not exist — only the directory it names is used, as the
 * place the upward walk starts.
 *
 * `require` rather than `import(require.resolve(...))`: graphql@16 declares no `exports`
 * map and its `index.js` is CJS that assigns every export through
 * `Object.defineProperty(exports, name, { get })`. Named-export detection for a CJS file
 * loaded through `import()` goes via cjs-module-lexer, so the shape buildql gets back would
 * depend on that lexer keeping up with graphql's codegen. `require` hands back
 * `module.exports` itself and cannot mis-detect anything.
 */
async function importGraphql(cwd: string | undefined): Promise<typeof GraphqlModule | undefined> {
  try {
    return await import('graphql');
  } catch {
    // Unresolvable from buildql. Under npx that is the normal case, not yet an error.
  }
  if (cwd === undefined) return undefined;
  try {
    const gql: unknown = createRequire(join(cwd, 'buildql-graphql-resolution.cjs'))('graphql');
    return isGraphqlModule(gql) ? gql : undefined;
  } catch {
    return undefined;
  }
}

async function introspectSdl(source: string, opts: LoadOptions): Promise<IntrospectionResult> {
  const gql = await importGraphql(opts.cwd);
  if (!gql) {
    throw new Error(
      `buildql: reading "${source}" as SDL needs the optional peer dependency "graphql", ` +
        `which could not be resolved from buildql${opts.cwd === undefined ? '' : ` or from ${opts.cwd}`}. ` +
        'Install it (`npm install --save-dev graphql`), or point `schema` at an introspection ' +
        '.json file or a URL instead. Running buildql through `npx`/`dlx` resolves "graphql" ' +
        'from your project directory, so install it there rather than alongside buildql.',
    );
  }
  const sdl = await readFile(source, 'utf8');
  const schema = gql.buildSchema(sdl, { assumeValidSDL: true });
  const result = gql.executeSync({ schema, document: gql.parse(INTROSPECTION_QUERY) }).data;
  if (!isIntrospectionResult(result)) {
    throw new Error(`buildql: introspection of "${source}" returned no __schema`);
  }
  return result;
}

async function introspectJson(source: string): Promise<IntrospectionResult> {
  const raw = JSON.parse(await readFile(source, 'utf8')) as
    IntrospectionResult | { data: IntrospectionResult };
  const schema = '__schema' in raw ? raw : raw.data;
  if (!schema?.__schema) {
    throw new Error(`buildql: "${source}" does not contain an introspection result (no __schema key)`);
  }
  return schema;
}

/** Load a schema from a URL, an introspection .json file, or an SDL file. */
export function loadSchema(source: string, opts: LoadOptions = {}): Promise<IntrospectionResult> {
  if (/^https?:\/\//.test(source)) return introspectUrl(source, opts);
  if (source.endsWith('.json')) return introspectJson(source);
  return introspectSdl(source, opts);
}
