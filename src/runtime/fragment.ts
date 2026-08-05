import type { Node, On, Spread, SpreadTarget } from '../types/node.js';
import type { Selected, VarsIn } from '../types/select.js';
import type { RESULT, VARS } from '../types/symbols.js';
import type { FragmentDef } from './print.js';

export interface FragmentHandle<R, V> extends SpreadTarget {
  readonly [RESULT]?: R;
  readonly [VARS]?: V;
}

/** Codegen emits one of these per object type so the type condition is fixed. */
export function makeFragment<F>(typeCondition: string, fields: F) {
  return <S extends readonly Node[]>(
    name: string,
    pick: (f: F) => readonly [...S],
  ): FragmentHandle<Selected<S>, VarsIn<S>> =>
    ({ name, typeCondition, sels: pick(fields) }) as FragmentHandle<Selected<S>, VarsIn<S>>;
}

export function spread<R, V>(f: FragmentHandle<R, V>): Spread<R, V> {
  // Phantom attachment only: `handle: f` is the real runtime value already
  // shaped like `SpreadTarget`; the cast exists solely to stamp the `R`/`V`
  // type parameters onto the returned `Spread`.
  return { kind: 'spread', handle: f } as unknown as Spread<R, V>;
}

/**
 * Walks a selection tree collecting every reachable fragment, deduped by name.
 * Two different fragment handles sharing a name is a conflict — printing would
 * silently keep whichever one was discovered first while the *other* call site's
 * inferred result type kept describing the fields it actually picked, producing a
 * type that lies about what the server returns. Reusing the very same handle in two
 * places is fine and must not throw, so handles are compared by identity, not name
 * alone (mirrors `dedupeVarRefs` in `print.ts`, which does the same for variables).
 */
export function collectFragments(sels: readonly Node[]): FragmentDef[] {
  const found = new Map<string, SpreadTarget>();
  const walk = (nodes: readonly Node[]): void => {
    for (const n of nodes) {
      if (n.kind === 'spread') {
        const seen = found.get(n.handle.name);
        if (seen && seen !== n.handle) {
          throw new Error(
            `buildql: two different fragments are both named "${n.handle.name}". ` +
              'Fragment names must be unique — give one of them a different name.',
          );
        }
        if (!seen) {
          found.set(n.handle.name, n.handle);
          walk(n.handle.sels);
        }
        continue;
      }
      if (n.kind === 'on') {
        walk((n as On<string, unknown>).sels);
        continue;
      }
      const sel = n as { sels?: readonly Node[] };
      if (sel.sels) walk(sel.sels);
    }
  };
  walk(sels);
  return [...found.values()];
}
