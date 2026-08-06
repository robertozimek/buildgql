import type { VarMarker, VarProxy } from '../types/vars.js';
import { makeVarMarker } from './markers.js';

export { isVarMarker, markerName } from './markers.js';

/**
 * Placeholder proxy. The accessed key is deliberately ignored: a mapped type
 * over `string` cannot preserve it, so the type system names the variable after
 * the *argument key* instead. Recording `null` here keeps runtime and types in
 * agreement — see `splitArgs` in builders.ts.
 */
export const $: VarProxy = new Proxy({} as VarProxy, {
  get() {
    return makeVarMarker(null);
  },
});

/** Explicitly name a variable — use when two fields would collide on an arg key. */
export function v<N extends string>(name: N): VarMarker<N> {
  return makeVarMarker(name) as VarMarker<N>;
}
