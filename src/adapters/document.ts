import { parse } from 'graphql';
import type { DocumentNode } from 'graphql';
import type { Operation } from '../runtime/operation.js';
import type { VarsArg } from '../types/vars.js';

export type OperationKind = Operation<unknown, unknown>['kind'];

/**
 * A `DocumentNode` carrying its result and variable types as a phantom property.
 *
 * Declared here rather than imported from `@graphql-typed-document-node/core` so that
 * neither buildql nor its consumers take on that dependency: Apollo Client and urql read
 * `__apiType` structurally, and TypeScript's structural typing makes this interface
 * interchangeable with theirs. `test/types/adapters.test-d.ts` pins that interop against
 * the real package.
 */
export interface TypedDocumentNode<R, V> extends DocumentNode {
  __apiType?: (variables: V) => R;
}

/**
 * Parsing is memoised on the operation object itself. Apollo and urql both key their
 * document caches (and, for Apollo, its query manager) on AST identity, so handing them a
 * freshly parsed node on every call would defeat caching and re-trigger network requests
 * on every render. A `WeakMap` keeps this from pinning operations that go out of scope.
 *
 * Only per-adapter identity is a contract (each of `apolloDocument`/`urqlDocument` returns
 * the same node across calls for the same operation) — tsup code-splits the ESM build so
 * both adapters share one `WeakMap` via a common chunk, but not the CJS build, where
 * `dist/adapters/apollo.cjs` and `dist/adapters/urql.cjs` each get their own module instance
 * and therefore their own cache. `apolloDocument(op) !== urqlDocument(op)` under `require`
 * as a result; do not rely on cross-adapter document identity.
 */
const cache = new WeakMap<Operation<unknown, unknown>, DocumentNode>();

/** The operation's printed document, parsed into a typed GraphQL AST. */
export function toDocument<R, V>(op: Operation<R, V>): TypedDocumentNode<R, V> {
  const hit = cache.get(op);
  if (hit) return hit;
  const doc = parse(op.document);
  cache.set(op, doc);
  return doc;
}

/**
 * Throws unless `op` is one of `allowed`. Clients that key their options object off the
 * operation type (Apollo: `{ query }` vs `{ mutation }`) otherwise fail deep inside the
 * client with a message that does not name the offending operation.
 */
export function assertKind(
  op: Operation<unknown, unknown>,
  allowed: readonly OperationKind[],
  helper: string,
): void {
  if (!allowed.includes(op.kind)) {
    throw new Error(
      `buildql: ${helper}() expects a ${allowed.join(' or ')} operation, ` +
        `but "${op.name}" is a ${op.kind}.`,
    );
  }
}

/**
 * The variables from an adapter's trailing rest parameter, defaulting to `{}`.
 *
 * `VarsArg` makes the slot optional only when every variable is optional, so the
 * `{}` fallback is reachable exactly when it is correct.
 */
export function variablesOf<V>(rest: VarsArg<V>): V {
  const [vars] = rest as [V | undefined];
  return (vars ?? {}) as V;
}
