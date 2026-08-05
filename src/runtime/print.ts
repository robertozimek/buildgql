import type { AnySel, DirectiveNode, Node, On, Spread, VarRef } from '../types/node.js';

export interface FragmentDef {
  readonly name: string;
  readonly typeCondition: string;
  readonly sels: readonly Node[];
}

interface VarRefMarker {
  readonly __varRef: string;
}

function isVarRefMarker(x: unknown): x is VarRefMarker {
  return typeof x === 'object' && x !== null && typeof (x as VarRefMarker).__varRef === 'string';
}

/** GraphQL value literal serialisation. Enum values arrive pre-marked by codegen. */
function printValue(value: unknown): string {
  if (isVarRefMarker(value)) return `$${value.__varRef}`;
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(printValue).join(', ')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${printValue(v)}`);
    return `{${entries.join(', ')}}`;
  }
  throw new Error(`buildql: cannot serialise argument value of type ${typeof value}`);
}

function printArgs(argv: Record<string, unknown> | undefined): string {
  if (!argv) return '';
  const entries = Object.entries(argv).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  return `(${entries.map(([k, v]) => `${k}: ${printValue(v)}`).join(', ')})`;
}

function printDirectives(ds: readonly DirectiveNode[] | undefined): string {
  if (!ds || ds.length === 0) return '';
  return ds
    .map((d) => {
      const cond = typeof d.if === 'boolean' ? String(d.if) : `$${d.if.varName}`;
      return ` @${d.name}(if: ${cond})`;
    })
    .join('');
}

function printNode(n: Node): string {
  if (n.kind === 'spread') return `...${(n as Spread<unknown>).fragmentName}`;
  if (n.kind === 'on') {
    const o = n as On<string, unknown>;
    return `... on ${o.typename} ${printSels(o.sels)}`;
  }
  const s = n as AnySel;
  const head = s.alias ? `${s.alias}: ${s.name}` : s.name;
  const body = s.sels && s.sels.length > 0 ? ` ${printSels(s.sels)}` : '';
  return `${head}${printArgs(s.args)}${printDirectives(s.directives)}${body}`;
}

function printSels(sels: readonly Node[]): string {
  return `{ ${sels.map(printNode).join(' ')} }`;
}

/** Walks the whole tree, including inline fragments, spreads and directives. */
export function collectVarRefs(sels: readonly Node[]): VarRef[] {
  const out: VarRef[] = [];
  const walk = (nodes: readonly Node[]): void => {
    for (const n of nodes) {
      if (n.kind === 'on') {
        walk((n as On<string, unknown>).sels);
        continue;
      }
      if (n.kind === 'spread') {
        walk((n as unknown as { handle: { sels: readonly Node[] } }).handle.sels);
        continue;
      }
      const s = n as AnySel;
      if (s.varRefs) out.push(...s.varRefs);
      for (const d of s.directives ?? []) {
        if (typeof d.if !== 'boolean') out.push(d.if);
      }
      if (s.sels) walk(s.sels);
    }
  };
  walk(sels);
  return out;
}

function dedupeVarRefs(refs: readonly VarRef[]): VarRef[] {
  const byName = new Map<string, VarRef>();
  for (const ref of refs) {
    const seen = byName.get(ref.varName);
    if (seen && seen.gqlType !== ref.gqlType) {
      throw new Error(
        `buildql: variable $${ref.varName} is used with two different types ` +
          `(${seen.gqlType} and ${ref.gqlType}). Give one of them an explicit name with v('otherName').`,
      );
    }
    if (!seen) byName.set(ref.varName, ref);
  }
  return [...byName.values()];
}

export function printOperation(
  kind: 'query' | 'mutation' | 'subscription',
  name: string,
  sels: readonly Node[],
  fragments: readonly FragmentDef[] = [],
): string {
  const vars = dedupeVarRefs(collectVarRefs(sels));
  const sig = vars.length > 0 ? `(${vars.map((v) => `$${v.varName}: ${v.gqlType}`).join(', ')})` : '';
  const op = `${kind} ${name}${sig} ${printSels(sels)}`;
  const frags = fragments.map((f) => `fragment ${f.name} on ${f.typeCondition} ${printSels(f.sels)}`);
  return [op, ...frags].join(' ');
}
