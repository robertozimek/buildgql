import type { Operation } from '../runtime/operation.js';
import type { VarsArg } from '../types/vars.js';
import { toDocument } from './document.js';
import type { TypedDocumentNode } from './document.js';

export type { TypedDocumentNode } from './document.js';

/**
 * Arguments for urql's `useQuery`/`useSubscription`. urql uses the `query` key for every
 * operation kind, mutations included, so there is one shape here rather than Apollo's two.
 */
export interface UrqlArgs<R, V> {
  readonly query: TypedDocumentNode<R, V>;
  readonly variables: V;
}

/**
 * The operation as a typed urql document. Use this where urql takes the document
 * positionally: `client.query(urqlDocument(Op), vars)`, `useMutation(urqlDocument(Op))`.
 */
export function urqlDocument<R, V>(op: Operation<R, V>): TypedDocumentNode<R, V> {
  return toDocument(op);
}

/** `{ query, variables }` for `useQuery(...)` / `useSubscription(...)`. */
export function toUrqlArgs<R, V>(op: Operation<R, V>, ...rest: VarsArg<V>): UrqlArgs<R, V> {
  const [vars] = rest as [V | undefined];
  return { query: toDocument(op), variables: (vars ?? {}) as V };
}
