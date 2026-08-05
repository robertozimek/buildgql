import { readFile } from 'node:fs/promises';

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
  readonly headers?: Record<string, string>;
  readonly fetch?: typeof fetch;
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
    throw new Error(`buildql: introspection of ${url} failed: ${payload.errors.map((e) => e.message).join('; ')}`);
  }
  if (!payload.data?.__schema) {
    throw new Error(`buildql: introspection of ${url} returned no __schema`);
  }
  return payload.data;
}

async function introspectSdl(source: string): Promise<IntrospectionResult> {
  let gql: typeof import('graphql');
  try {
    gql = await import('graphql');
  } catch {
    throw new Error(
      `buildql: reading "${source}" as SDL needs the optional peer dependency "graphql". ` +
        'Install it, or point `schema` at an introspection .json file or a URL instead.',
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
    | IntrospectionResult
    | { data: IntrospectionResult };
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
  return introspectSdl(source);
}
