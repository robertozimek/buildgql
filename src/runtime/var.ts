import type { VarMarker, VarProxy } from '../types/vars.js';

const VAR = Symbol.for('buildql.var');

interface RuntimeMarker {
  readonly [VAR]: true;
  /** `null` means "take the name from the argument key". */
  readonly __var: string | null;
}

export function isVarMarker(x: unknown): x is VarMarker {
  return typeof x === 'object' && x !== null && (x as Record<symbol, unknown>)[VAR] === true;
}

function makeMarker(name: string | null): RuntimeMarker {
  return { [VAR]: true, __var: name };
}

/**
 * Placeholder proxy. The accessed key is deliberately ignored: a mapped type
 * over `string` cannot preserve it, so the type system names the variable after
 * the *argument key* instead. Recording `null` here keeps runtime and types in
 * agreement — see `splitArgs` in builders.ts.
 */
export const $: VarProxy = new Proxy({} as VarProxy, {
  get() {
    return makeMarker(null);
  },
});

/** Explicitly name a variable — use when two fields would collide on an arg key. */
export function v<N extends string>(name: N): VarMarker<N> {
  return makeMarker(name) as unknown as VarMarker<N>;
}

/** The explicit name, or `null` when the marker came from `$`. */
export function markerName(m: VarMarker): string | null {
  return (m as unknown as RuntimeMarker).__var;
}

export { VAR };
