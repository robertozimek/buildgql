import type {
  IntrospectionInputValue,
  IntrospectionResult,
  IntrospectionType,
  IntrospectionTypeRef,
} from './introspect.js';
import { resolveScalars } from './scalars.js';
import type { ResolvedScalars, ScalarMapping, ScalarPrelude } from './scalars.js';

export type IRKind = 'scalar' | 'enum' | 'object' | 'interface' | 'union' | 'input';

export interface IRTypeRef {
  readonly wrap: ('l' | '!')[];
  readonly name: string;
  readonly kind: IRKind;
}

export interface IRArg {
  readonly name: string;
  readonly type: IRTypeRef;
  readonly gqlType: string;
  readonly optional: boolean;
}

export interface IRField {
  readonly name: string;
  readonly type: IRTypeRef;
  readonly gqlType: string;
  readonly args: IRArg[];
  readonly description: string | null;
  readonly deprecated: string | null;
}

export interface IRType {
  readonly name: string;
  readonly kind: IRKind;
  readonly description: string | null;
  readonly fields: IRField[];
  readonly inputFields: IRArg[];
  readonly enumValues: string[];
  readonly possibleTypes: string[];
  readonly interfaces: string[];
}

export interface IRSchema {
  readonly queryType: string;
  readonly mutationType: string | null;
  readonly subscriptionType: string | null;
  readonly types: IRType[];
  readonly scalars: Record<string, ScalarMapping>;
  /** `import type` lines and type aliases the scalar config makes the generated module carry. */
  readonly scalarPrelude: ScalarPrelude;
}

function irKind(kind: string): IRKind {
  switch (kind) {
    case 'SCALAR':
      return 'scalar';
    case 'ENUM':
      return 'enum';
    case 'INTERFACE':
      return 'interface';
    case 'UNION':
      return 'union';
    case 'INPUT_OBJECT':
      return 'input';
    default:
      return 'object';
  }
}

/** Flattens a nested type ref into an outer-to-inner wrapper tuple plus a named type. */
function flatten(ref: IntrospectionTypeRef, kinds: ReadonlyMap<string, IRKind>): IRTypeRef {
  const wrap: ('l' | '!')[] = [];
  let cur: IntrospectionTypeRef | null = ref;
  while (cur) {
    if (cur.kind === 'NON_NULL') {
      wrap.push('!');
      cur = cur.ofType;
    } else if (cur.kind === 'LIST') {
      wrap.push('l');
      cur = cur.ofType;
    } else {
      const name = cur.name ?? 'Unknown';
      return { wrap, name, kind: kinds.get(name) ?? irKind(cur.kind) };
    }
  }
  throw new Error('buildql: malformed type reference in introspection result');
}

/** Prints a type ref back to GraphQL syntax, for variable definitions. */
function printGqlType(ref: IntrospectionTypeRef): string {
  if (ref.kind === 'NON_NULL') return `${printGqlType(ref.ofType!)}!`;
  if (ref.kind === 'LIST') return `[${printGqlType(ref.ofType!)}]`;
  return ref.name ?? 'Unknown';
}

function toArg(iv: IntrospectionInputValue, kinds: ReadonlyMap<string, IRKind>): IRArg {
  const nullable = iv.type.kind !== 'NON_NULL';
  return {
    name: iv.name,
    type: flatten(iv.type, kinds),
    gqlType: printGqlType(iv.type),
    optional: nullable || iv.defaultValue !== null,
  };
}

export function buildIR(schema: IntrospectionResult, scalars: ResolvedScalars = resolveScalars()): IRSchema {
  const relevant = schema.__schema.types.filter((t: IntrospectionType) => !t.name.startsWith('__'));
  const kinds = new Map<string, IRKind>(relevant.map((t) => [t.name, irKind(t.kind)]));

  const types: IRType[] = relevant.map((t) => ({
    name: t.name,
    kind: irKind(t.kind),
    description: t.description,
    fields: (t.fields ?? []).map((f) => ({
      name: f.name,
      type: flatten(f.type, kinds),
      gqlType: printGqlType(f.type),
      args: f.args.map((a) => toArg(a, kinds)),
      description: f.description,
      deprecated: f.isDeprecated ? (f.deprecationReason ?? 'deprecated') : null,
    })),
    inputFields: (t.inputFields ?? []).map((a) => toArg(a, kinds)),
    enumValues: (t.enumValues ?? []).map((e) => e.name),
    possibleTypes: (t.possibleTypes ?? []).map((p) => p.name ?? ''),
    interfaces: (t.interfaces ?? []).map((i) => i.name ?? ''),
  }));

  return {
    queryType: schema.__schema.queryType.name,
    mutationType: schema.__schema.mutationType?.name ?? null,
    subscriptionType: schema.__schema.subscriptionType?.name ?? null,
    types,
    // A null-prototype target means a scalar legitimately named `toString`, `valueOf`,
    // or `constructor` cannot resolve to an inherited `Object.prototype` member on
    // either an `in`/`Object.hasOwn` membership check or a plain bracket read — there
    // is no prototype chain left to walk. `resolveScalars` has already merged the
    // built-in five underneath the user's overrides.
    scalars: Object.assign(Object.create(null) as Record<string, ScalarMapping>, scalars.scalars),
    scalarPrelude: scalars.prelude,
  };
}
