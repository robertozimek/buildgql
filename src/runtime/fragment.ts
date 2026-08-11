import type {
  FragmentDefinition,
  FragmentSpread,
  InlineFragment,
  SelectionNode,
} from '../types/selection.js';
import type { Selected, VarsIn } from '../types/select.js';
import type { RESULT, VARS } from '../types/symbols.js';

export interface Fragment<R, V> extends FragmentDefinition {
  readonly [RESULT]?: R;
  readonly [VARS]?: V;
}

/** Codegen emits one of these per object type so the type condition is fixed. */
export function makeFragment<F>(typeCondition: string, fields: F) {
  return <S extends readonly SelectionNode[]>(
    name: string,
    pick: (f: F) => readonly [...S],
  ): Fragment<Selected<S>, VarsIn<S>> =>
    ({ name, typeCondition, sels: pick(fields) }) as Fragment<Selected<S>, VarsIn<S>>;
}

export function spread<R, V>(f: Fragment<R, V>): FragmentSpread<R, V> {
  // Phantom attachment only: `fragment: f` is the real runtime value already
  // shaped like `FragmentDefinition`; the cast exists solely to stamp the `R`/`V`
  // type parameters onto the returned `FragmentSpread`.
  return { kind: 'spread', fragment: f } as unknown as FragmentSpread<R, V>;
}

/**
 * Walks a selection tree collecting every reachable fragment, deduped by name.
 * Two different fragments sharing a name is a conflict — printing would
 * silently keep whichever one was discovered first while the *other* call site's
 * inferred result type kept describing the fields it actually picked, producing a
 * type that lies about what the server returns. Reusing the very same fragment in two
 * places is fine and must not throw, so fragments are compared by identity, not name
 * alone (mirrors `dedupeVarRefs` in `print.ts`, which does the same for variables).
 */
export function collectFragments(sels: readonly SelectionNode[]): FragmentDefinition[] {
  const found = new Map<string, FragmentDefinition>();
  const walk = (nodes: readonly SelectionNode[]): void => {
    for (const n of nodes) {
      if (n.kind === 'spread') {
        const seen = found.get(n.fragment.name);
        if (seen && seen !== n.fragment) {
          throw new Error(
            `buildgql: two different fragments are both named "${n.fragment.name}". ` +
              'Fragment names must be unique — give one of them a different name.',
          );
        }
        if (!seen) {
          found.set(n.fragment.name, n.fragment);
          walk(n.fragment.sels);
        }
        continue;
      }
      if (n.kind === 'on') {
        walk((n as InlineFragment<string, unknown>).sels);
        continue;
      }
      const sel = n as { sels?: readonly SelectionNode[] };
      if (sel.sels) walk(sel.sels);
    }
  };
  walk(sels);
  return [...found.values()];
}
