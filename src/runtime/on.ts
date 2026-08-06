import type { InlineFragment, SelectionNode } from '../types/selection.js';
import type { Selected, VarsIn } from '../types/select.js';
import type { Simplify } from '../types/util.js';

/**
 * Narrow a union or interface field to a concrete type.
 * `__typename` is injected into the result type of every branch so the union
 * discriminates; the printer adds the matching field to the document.
 */
export function on<TN extends string, F, S extends readonly SelectionNode[]>(
  typename: TN,
  fields: F,
  pick: (f: F) => readonly [...S],
): InlineFragment<TN, Simplify<Selected<S> & { __typename: TN }>, VarsIn<S>> {
  return { kind: 'on', typename, sels: pick(fields) } as InlineFragment<
    TN,
    Simplify<Selected<S> & { __typename: TN }>,
    VarsIn<S>
  >;
}
