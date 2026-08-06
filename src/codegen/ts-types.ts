import type { IRField, IRSchema, IRType, IRTypeRef } from './ir.js';
import { UNKNOWN_SCALAR } from './scalars.js';

/**
 * Looks up a scalar's mapped TS type by *own* property only. A plain `map[name]` (or
 * `name in map`) walks the prototype chain, so a schema scalar legitimately named
 * `toString`, `valueOf`, or `constructor` would resolve to the inherited
 * `Object.prototype` member instead of `undefined` — silently treating it as "mapped"
 * and splicing e.g. `Object.prototype.toString` into the generated source. `ir.scalars`
 * is also built with a null prototype (see `buildIR`) as defense in depth.
 */
function scalarTsType(ir: IRSchema, name: string): string | undefined {
  return Object.hasOwn(ir.scalars, name) ? ir.scalars[name] : undefined;
}

/** The TypeScript type a *leaf* (scalar/enum) named type maps to. */
export function leafTsType(ref: IRTypeRef, ir: IRSchema): string {
  if (ref.kind === 'enum') return ref.name;
  return scalarTsType(ir, ref.name) ?? UNKNOWN_SCALAR;
}

/**
 * True when `type` binds tighter than a postfix `[]`, so `${type}[]` means what it looks
 * like. Identifiers, dotted qualified names, generic instantiations and object-literal
 * types all qualify.
 *
 * A union does not: `string | number` + `[]` parses as `string | (number[])`, a different
 * and wrong type. Neither does a function type. Scalar mappings come from user config as
 * raw TypeScript source (`scalars: { JSON: 'string | number' }`), so either can arrive here.
 */
function isAtomicTypeExpression(type: string): boolean {
  const named = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*(<.*>)?$/;
  const objectLiteral = /^\{.*\}$/;
  return named.test(type) || objectLiteral.test(type);
}

/** The TypeScript type of an *input* position, wrappers included. */
export function inputTsType(ref: IRTypeRef, ir: IRSchema): string {
  const base =
    ref.kind === 'input' || ref.kind === 'enum' ? ref.name : (scalarTsType(ir, ref.name) ?? UNKNOWN_SCALAR);
  // Walk the wrapper inner-to-outer, mirroring Apply<> from the runtime.
  // Only the base needs the atomicity guard: every later iteration appends to a
  // string already ending in `[]`, which binds tightly on its own.
  let out = isAtomicTypeExpression(base) ? base : `(${base})`;
  const toks = [...ref.wrap].reverse();
  let nonNull = false;
  for (const tok of toks) {
    if (tok === '!') {
      nonNull = true;
    } else {
      out = nonNull ? `${out}[]` : `(${out} | null)[]`;
      nonNull = false;
    }
  }
  return nonNull ? out : `${out} | null`;
}

/** The TS type of a field's argument object, e.g. `{ name: string; age?: number }`. */
export function argTsType(field: IRField, ir: IRSchema): string {
  const entries = field.args
    .map((a) => `${a.name}${a.optional ? '?' : ''}: ${inputTsType(a.type, ir)}`)
    .join('; ');
  return `{ ${entries} }`;
}

/**
 * The TS type of `__typename` for a type map. A union or interface can resolve to
 * one of several `possibleTypes` at runtime, so it must be typed as their union —
 * typing it as the abstract type's own name (e.g. `'Pet'`, a value the server never
 * actually sends) makes `__typename` collide with every `on()` branch's literal and
 * collapses the field to `never` wherever the two are intersected (see `Selected`
 * in `src/types/select.ts`). Concrete object types keep their own single literal name.
 */
export function typenameTsType(t: IRType): string {
  if (t.kind === 'union' || t.kind === 'interface') {
    if (t.possibleTypes.length === 0) return 'string';
    return t.possibleTypes.map((p) => `'${p}'`).join(' | ');
  }
  return `'${t.name}'`;
}

/**
 * Every custom scalar in the schema with no entry in `ir.scalars` — these fall back
 * to `UNKNOWN_SCALAR` (`unknown`) in the generated output, which silently drops all
 * type safety for that field (and, in argument position, all argument checking). The
 * CLI surfaces this list as a warning so the degradation is loud rather than silent.
 */
export function unmappedScalars(ir: IRSchema): string[] {
  const names = new Set<string>();
  for (const t of ir.types) {
    if (t.kind === 'scalar' && !Object.hasOwn(ir.scalars, t.name)) names.add(t.name);
  }
  return [...names].sort();
}
