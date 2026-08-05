import type { Operation } from '../runtime/operation.js';
import type { VarsArg } from '../types/varargs.js';
import { assertKind, toDocument } from './document.js';
import type { TypedDocumentNode } from './document.js';

export type { TypedDocumentNode } from './document.js';

/** Options for `apolloClient.query()`, `.watchQuery()` and `.subscribe()`. */
export interface ApolloQueryArgs<R, V> {
  readonly query: TypedDocumentNode<R, V>;
  readonly variables: V;
}

/** Options for `apolloClient.mutate()`. */
export interface ApolloMutationArgs<R, V> {
  readonly mutation: TypedDocumentNode<R, V>;
  readonly variables: V;
}

/**
 * The operation as a typed Apollo document. Use this for the React hooks, which take the
 * document positionally: `useQuery(apolloDocument(Op), { variables })`.
 */
export function apolloDocument<R, V>(op: Operation<R, V>): TypedDocumentNode<R, V> {
  return toDocument(op);
}

/**
 * `{ query, variables }` for `apolloClient.query()`. Subscriptions are accepted too —
 * Apollo's `client.subscribe()` takes the same `query` key.
 */
export function toApolloQuery<R, V>(op: Operation<R, V>, ...rest: VarsArg<V>): ApolloQueryArgs<R, V> {
  assertKind(op, ['query', 'subscription'], 'toApolloQuery');
  const [vars] = rest as [V | undefined];
  return { query: toDocument(op), variables: (vars ?? {}) as V };
}

/** `{ mutation, variables }` for `apolloClient.mutate()`. */
export function toApolloMutation<R, V>(op: Operation<R, V>, ...rest: VarsArg<V>): ApolloMutationArgs<R, V> {
  assertKind(op, ['mutation'], 'toApolloMutation');
  const [vars] = rest as [V | undefined];
  return { mutation: toDocument(op), variables: (vars ?? {}) as V };
}
