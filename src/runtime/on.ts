import type { Node, On } from '../types/node.js';
import type { Selected, VarsIn } from '../types/select.js';
import type { Simplify } from '../types/util.js';

/**
 * Narrow a union or interface field to a concrete type.
 * `__typename` is injected into the result type of every branch so the union
 * discriminates; the printer adds the matching field to the document.
 */
export function on<TN extends string, F, S extends readonly Node[]>(
  typename: TN,
  fields: F,
  pick: (f: F) => readonly [...S],
): On<TN, Simplify<Selected<S> & { __typename: TN }>, VarsIn<S>> {
  return { kind: 'on', typename, sels: pick(fields) } as On<
    TN,
    Simplify<Selected<S> & { __typename: TN }>,
    VarsIn<S>
  >;
}
