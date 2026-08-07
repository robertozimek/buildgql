import type { SelectionNode } from '../types/selection.js';
import type { Selected, VarsIn } from '../types/select.js';
import type { RESULT, VARS } from '../types/symbols.js';
import type { Simplify } from '../types/util.js';
import type { VarProxy } from '../types/vars.js';
import { collectFragments } from './fragment.js';
import { printOperation } from './print.js';
import { $ } from './var.js';

export interface Operation<R, V> {
  readonly kind: 'query' | 'mutation' | 'subscription';
  readonly name: string;
  readonly document: string;
  readonly sels: readonly SelectionNode[];
  readonly [RESULT]?: R;
  readonly [VARS]?: V;
}

function makeOperation(kind: Operation<unknown, unknown>['kind']) {
  return <Root>(root: Root) =>
    <S extends readonly SelectionNode[]>(
      name: string,
      build: (v: VarProxy, r: Root) => readonly [...S],
    ): Operation<Selected<S>, Simplify<VarsIn<S>>> => {
      const sels = build($, root);
      const document = printOperation(kind, name, sels, collectFragments(sels));
      return { kind, name, document, sels } as Operation<Selected<S>, Simplify<VarsIn<S>>>;
    };
}

export const makeQuery = makeOperation('query');
export const makeMutation = makeOperation('mutation');
export const makeSubscription = makeOperation('subscription');
