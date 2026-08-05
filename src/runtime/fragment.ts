import type { Node, On, Spread } from '../types/node.js';
import type { Selected, VarsIn } from '../types/select.js';
import type { RESULT, VARS } from '../types/symbols.js';
import type { FragmentDef } from './print.js';

export interface FragmentHandle<R, V> {
  readonly name: string;
  readonly typeCondition: string;
  readonly sels: readonly Node[];
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

interface RuntimeSpread {
  readonly kind: 'spread';
  readonly fragmentName: string;
  readonly handle: FragmentHandle<unknown, unknown>;
}

export function spread<R, V>(f: FragmentHandle<R, V>): Spread<R, V> {
  return { kind: 'spread', fragmentName: f.name, handle: f } as unknown as Spread<R, V>;
}

/** Walks a selection tree collecting every reachable fragment, deduped by name. */
export function collectFragments(sels: readonly Node[]): FragmentDef[] {
  const found = new Map<string, FragmentDef>();
  const walk = (nodes: readonly Node[]): void => {
    for (const n of nodes) {
      if (n.kind === 'spread') {
        const s = n as unknown as RuntimeSpread;
        if (!found.has(s.fragmentName)) {
          found.set(s.fragmentName, {
            name: s.handle.name,
            typeCondition: s.handle.typeCondition,
            sels: s.handle.sels,
          });
          walk(s.handle.sels);
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
