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
 * True when appending `[]` to `type` produces the type it looks like it produces — i.e.
 * `type` has no top-level (bracket-depth-0) union `|`, intersection `&`, or arrow `=>`.
 * Those three operators bind looser than a postfix `[]`, so e.g. `A | B[]` parses as
 * `A | (B[])`, not `(A | B)[]` — the exact defect this function exists to prevent.
 *
 * This is a bracket-depth scan, not a regex. A prior version used
 * `/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*(<.*>)?$/` for identifiers/generics and
 * `/^\{.*\}$/` for object literals — both are bracket-depth-blind: `.*` spans from the
 * first `<`/`{` to the LAST `>`/`}` in the whole string, so a multi-operand union or
 * intersection whose final operand happens to end in `>` or `}` (e.g.
 * `Record<string, unknown> | Array<unknown>`, `{ a: string } | { b: number }`) matched the
 * regex end-to-end and was wrongly classified atomic — the identical wrong-parse defect
 * this function exists to close, just relocated to a shape the regex couldn't see. Tracking
 * nesting depth across `(`/`)`, `[`/`]`, `{`/`}` and `<`/`>`, and only inspecting `|`/`&`/`=>`
 * once depth returns to 0, is the only way to find a top-level operator that a fixed-shape
 * regex cannot express (a regex has no notion of "matching bracket depth").
 *
 * `>` needs one exception: a `>` immediately preceded by `=` is the tail of an arrow `=>`,
 * not the close of a `<...>` this scan opened (arrow functions never open with `<`), so it is
 * excluded from the closer set below. An earlier version of this scan missed that and
 * decremented depth for it anyway, which desynchronised every check after the first function
 * type in the string — e.g. `Record<string, () => void> | string` reached depth 0 one
 * bracket too early, inside the generic, and its real top-level `|` was never seen.
 *
 * What this guarantees: every `|`, `&` or top-level `=>` in `type` is found, however deeply
 * other operators are nested inside brackets elsewhere in the string, so `type` is correctly
 * parenthesised before a postfix `[]` is appended. An unmatched closer (depth going negative)
 * is treated as non-atomic rather than trusted — parenthesising an already-atomic type is
 * harmless, whereas guessing atomic for a string this scan can't balance risks reproducing
 * the wrong-parse bug it exists to prevent.
 *
 * What this does NOT guarantee: this is not a TypeScript parser. It has no notion of string
 * or template literals, comments, or conditional types (`T extends U ? X : Y`), so a scalar
 * mapping containing a quoted `'|'` could still be misclassified as non-atomic (safe: it only
 * adds harmless parens) or, in principle, atomic if the quoted content itself balances
 * brackets in a way that hides a real top-level operator (not safe, but not a shape any
 * existing test or fixture produces). Scalar mappings are short, hand-written raw type
 * expressions from user config (`scalars: { JSON: 'string | number' }`), not arbitrary
 * program source, so that residual gap is accepted rather than built out.
 */
function isAtomicTypeExpression(type: string): boolean {
  let depth = 0;
  for (let i = 0; i < type.length; i++) {
    const ch = type[i];
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}' || (ch === '>' && type[i - 1] !== '=')) {
      // A `>` immediately preceded by `=` is the tail of an arrow `=>`, not the close of a
      // `<...>` this scan opened. Decrementing depth for it desynchronises every check after
      // it: e.g. `Record<string, () => void> | string` would see depth hit 0 one bracket too
      // early, inside the generic, and its top-level `|` would then be missed entirely.
      depth--;
      // An unmatched closer (depth would go negative) means the scan can no longer trust its
      // own bracket accounting. Fail toward parenthesising — parens around an already-atomic
      // type are harmless, but silently treating a string the scan can't make sense of as
      // atomic risks reproducing the exact wrong-parse bug this function exists to prevent.
      if (depth < 0) return false;
    } else if (depth === 0 && (ch === '|' || ch === '&' || (ch === '=' && type[i + 1] === '>'))) {
      return false;
    }
  }
  return true;
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
