import type { VarMarker } from '../types/vars.js';

// `Symbol.for`, not `Symbol()`: the dual ESM/CJS build can put two copies of this
// module in one process (see the note on the document cache in
// src/adapters/document.ts), and markers made by one must be recognised by the other.
const VAR = Symbol.for('buildgql.var');
const ENUM = Symbol.for('buildgql.enum');
const VAR_REF = Symbol.for('buildgql.varRef');

interface RuntimeVarMarker {
  readonly [VAR]: true;
  /** `null` means "take the name from the argument key". */
  readonly __var: string | null;
}

/** A GraphQL enum literal, which must print unquoted. */
export interface EnumValue {
  readonly [ENUM]: string;
}

/** A resolved `$name` reference standing in an argument position. */
export interface VarRefValue {
  readonly [VAR_REF]: string;
}

export function makeVarMarker(name: string | null): VarMarker {
  return { [VAR]: true, __var: name } as unknown as VarMarker;
}

export function isVarMarker(x: unknown): x is VarMarker {
  return typeof x === 'object' && x !== null && (x as Record<symbol, unknown>)[VAR] === true;
}

/** The explicit name, or `null` when the marker came from `$`. */
export function markerName(m: VarMarker): string | null {
  return (m as unknown as RuntimeVarMarker).__var;
}

export function enumValue(value: string): EnumValue {
  return { [ENUM]: value };
}

export function isEnumValue(x: unknown): x is EnumValue {
  return typeof x === 'object' && x !== null && typeof (x as Record<symbol, unknown>)[ENUM] === 'string';
}

export function varRefValue(name: string): VarRefValue {
  return { [VAR_REF]: name };
}

export function isVarRefValue(x: unknown): x is VarRefValue {
  return typeof x === 'object' && x !== null && typeof (x as Record<symbol, unknown>)[VAR_REF] === 'string';
}

export { ENUM, VAR, VAR_REF };
