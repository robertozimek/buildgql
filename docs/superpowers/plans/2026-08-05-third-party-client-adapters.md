# Third-Party GraphQL Client Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let buildql users run their generated operations through Apollo Client or urql instead of buildql's own `createClient`, selected via a `client` field in `buildql.config.*`.

**Architecture:** Two new adapter entry points (`buildql/adapters/apollo`, `buildql/adapters/urql`) convert an `Operation<R, V>` into the exact options object each client's API expects, backed by a shared `toDocument()` that lazily `parse()`s the already-printed `op.document` into a `TypedDocumentNode<R, V>` and memoises it in a `WeakMap`. A new `client` config field drives which adapter (if any) the generated module imports and re-exports. Relay is explicitly out of scope — its store requires ahead-of-time relay-compiler artifacts that a runtime-built document cannot provide.

**Tech Stack:** TypeScript >= 5.4, Node >= 18, `graphql` (optional peer dep — required only when an adapter is used), Vitest for unit/e2e, plain `tsc` for type tests, tsup for builds.

## Global Constraints

- TypeScript **>= 5.4**, `"strict": true`. Type tests are plain `tsc` files under `test/types/*.test-d.ts` using `@ts-expect-error` — there is no `expectTypeOf` runner.
- Node **>= 18**. Build target `node18`.
- `graphql` stays an **optional** peer dependency (`peerDependenciesMeta.graphql.optional === true`). `src/index.ts` and `src/client/**` must never import it. Only `src/adapters/**` may.
- Adapters must not depend on `@apollo/client`, `@urql/core`, or `@graphql-typed-document-node/core` at runtime **or** in their published types. The returned option objects are structurally typed so they drop into those clients without buildql knowing about them.
- The default (`client: 'buildql'`) generated output must stay **byte-identical** to today's output. Existing tests in `test/unit/emit.test.ts`, `test/unit/cli.test.ts` and `test/e2e/generate-and-run.test.ts` assert against it.
- All error messages are prefixed `buildql: `.
- Every module uses ESM `.js` extensions in relative imports (`'../runtime/operation.js'`), matching the existing codebase.
- The type-instantiation budget gate (`npm run test:perf`, 25,000 instantiations / 3s check time) must still pass.
- Verification command for the whole suite: `npm run check` (`test:types` + `test` + `test:perf`).

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/types/varargs.ts` | Shared "does this variables map force a positional argument" types, used by both `client.ts` and the adapters. |
| `src/adapters/document.ts` | `TypedDocumentNode<R, V>` declaration, memoised `toDocument()`, `assertKind()` guard. Internal — not a published entry point. |
| `src/adapters/apollo.ts` | Published entry `buildql/adapters/apollo`. Apollo-shaped option objects. |
| `src/adapters/urql.ts` | Published entry `buildql/adapters/urql`. urql-shaped option objects. |
| `src/codegen/clients.ts` | The `ClientKind` union, its runtime value list, and the per-client emit spec (which module to import from, which names). Single source of truth shared by the emitter and the config validator. |
| `test/types/varargs.test-d.ts` | Type test for `VarsArg`. |
| `test/unit/adapters.test.ts` | Runtime tests for `toDocument`, apollo and urql adapters. |
| `test/types/adapters.test-d.ts` | Type tests: variable arity, result inference, `TypedDocumentNode` interop. |

**Modified:**

| File | Change |
|---|---|
| `src/client/client.ts:23-29` | Delete local `RequiredKeys`/`HasVars`, import from `src/types/varargs.ts`. |
| `src/codegen/emit.ts:9-31,163-184` | `IMPORTS`/`REEXPORTS` consts become functions of `ClientKind`; `emit()` takes a second parameter. |
| `src/cli/config.ts:5-14,69-85` | Add `client?: ClientKind` to `BuildQLConfig` + validation. |
| `src/cli/index.ts:12-37` | Pass `config.client` to `emit()`; print an adapter hint. |
| `package.json` | New `exports`/`typesVersions` subpaths, new devDependency, adapter note. |
| `tsup.config.ts` | Two new entry points. |
| `README.md` | "Using Apollo or urql" + "Relay" sections; adapter note under Requirements. |
| `test/unit/emit.test.ts` | Assertions for each `ClientKind`. |
| `test/unit/config.test.ts` | `client` validation cases. |
| `test/unit/cli.test.ts` | End-to-end generate with `client: 'urql'`. |
| `test/e2e/generate-and-run.test.ts` | Second generated module with `client: 'urql'`, typechecked and executed. |

### Design notes the implementer needs

**Why `TypedDocumentNode` is declared locally rather than imported.** `@graphql-typed-document-node/core` exports:

```ts
export interface DocumentTypeDecoration<TResult, TVariables> {
  __apiType?: (variables: TVariables) => TResult;
}
export interface TypedDocumentNode<TResult, TVariables>
  extends DocumentNode, DocumentTypeDecoration<TResult, TVariables> {}
```

Apollo Client and urql both consume that phantom `__apiType` property structurally. Declaring a structurally identical interface in `src/adapters/document.ts` gives full interop with zero published dependency. Task 2's type test proves the assignability against the real package (a devDependency only).

**Why `parse()` is a static import, not a dynamic one.** A dynamic `await import('graphql')` would make every adapter function async, which poisons the whole API. `src/adapters/*` therefore imports `parse` statically. Because these are separate entry points, `graphql` is only loaded when a user actually imports an adapter — the root `buildql` entry stays dependency-free. The cost is that a missing `graphql` surfaces as Node's own `ERR_MODULE_NOT_FOUND` ("Cannot find package 'graphql'") rather than a `buildql:`-prefixed message. That is acceptable and is documented in the README.

**Why the apollo adapter has kind guards and urql's does not.** Apollo uses a different option key per operation type (`{ query }` for `client.query`/`client.subscribe`, `{ mutation }` for `client.mutate`), so passing the wrong kind is a real mistake worth catching early. urql uses `{ query, variables }` for queries, mutations *and* subscriptions alike, so there is nothing to guard.

**Testing against real client libraries.** Only `@graphql-typed-document-node/core` is added as a devDependency — it is a types-only, three-interface package that has not changed since 2022, and it *is* the contract Apollo's `DocumentNode | TypedDocumentNode<...>` and urql's `DocumentInput<Data, Variables>` are both built from. Apollo's and urql's own packages are deliberately not installed: they are heavy, fast-moving, and have restructured their entry points between major versions, which would make the type tests fragile for no extra coverage. The Apollo/urql call shapes are instead pinned by local `declare function` mirrors of their public signatures, documented inline.

**A generic `buildql/adapters` entry point is intentionally not created.** The public surface is per-client only. `toDocument` exists as shared internals; if a generic entry is wanted later it is a one-line export map addition.

---

## Task 1: Shared variable-arity types

Extracts the "must the caller pass a `vars` argument?" logic out of `src/client/client.ts` so the adapters can reuse it instead of copying it. Pure refactor plus one new exported alias — no behaviour change.

**Files:**
- Create: `src/types/varargs.ts`
- Create: `test/types/varargs.test-d.ts`
- Modify: `src/client/client.ts:23-29`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RequiredKeys<V>` — keys of `V` that are not optional.
  - `type HasVars<V>` — `true` when `V` has at least one required key.
  - `type VarsArg<V>` — `[vars: NoInfer<V>]` when `HasVars<V>` is `true`, else `[vars?: NoInfer<V>]`. Tasks 3 and 4 spread this as their trailing parameter list.

- [ ] **Step 1: Write the failing type test**

Create `test/types/varargs.test-d.ts`:

```ts
import type { VarsArg } from '../../src/types/varargs.js';

// A stand-in for any adapter/client function that takes an operation's variables as
// its trailing parameter. Exercising `VarsArg` through a call signature (rather than
// comparing tuple types directly) is what actually pins the caller-facing behaviour.
declare function takeVars<V>(...rest: VarsArg<V>): V;

// A map with a required key forces the caller to pass one...
const withRequired = takeVars<{ id: string }>({ id: 'x' });
// @ts-expect-error a variables map with a required key cannot be omitted
const missing = takeVars<{ id: string }>();
// @ts-expect-error wrong variable type
const wrongType = takeVars<{ id: string }>({ id: 1 });

// ...while an all-optional map must NOT force a positional argument. This is the same
// regression `HasVars` guards for `client.execute` — a `keyof V extends never` version
// cannot tell `{ note?: string }` apart from `{ note: string }`.
const omitted = takeVars<{ note?: string }>();
const supplied = takeVars<{ note?: string }>({ note: 'hi' });

// An operation with no variables at all is the same case.
const empty = takeVars<{}>();

export { withRequired, missing, wrongType, omitted, supplied, empty };
```

- [ ] **Step 2: Run the type test to verify it fails**

Run: `npm run test:types`
Expected: FAIL with `Cannot find module '../../src/types/varargs.js' or its corresponding type declarations.`

- [ ] **Step 3: Create the shared module**

Create `src/types/varargs.ts`:

```ts
/** Keys of `V` that are not optional. */
export type RequiredKeys<V> = { [K in keyof V]-?: {} extends Pick<V, K> ? never : K }[keyof V];

/** True when the operation declared at least one REQUIRED variable — an all-optional
 *  variable map (e.g. `{ after?: string }`) must not force a positional `vars` argument. */
export type HasVars<V> = RequiredKeys<V> extends never ? false : true;

/**
 * The trailing parameter list carrying an operation's variables, and nothing else.
 * `NoInfer` stops `V` being re-inferred from the argument, which would otherwise let a
 * pre-declared object with missing keys through silently.
 *
 * `client.execute`/`client.subscribe` need a second `ExecuteOptions` slot as well, so they
 * build their own tuple from `HasVars` rather than using this alias — see `client.ts`.
 */
export type VarsArg<V> = HasVars<V> extends true ? [vars: NoInfer<V>] : [vars?: NoInfer<V>];
```

- [ ] **Step 4: Point `client.ts` at the shared module**

In `src/client/client.ts`, add the import alongside the existing ones at the top:

```ts
import type { HasVars } from '../types/varargs.js';
```

Then replace lines 23-29 — the local `RequiredKeys`, `HasVars` and `VarArgs` block — with just:

```ts
type VarArgs<V> = HasVars<V> extends true ? [vars: NoInfer<V>, opts?: ExecuteOptions] : [vars?: NoInfer<V>, opts?: ExecuteOptions];
```

The `RequiredKeys` and `HasVars` declarations (and their comments, which now live in `varargs.ts`) are deleted from `client.ts`.

- [ ] **Step 5: Run the full check**

Run: `npm run check`
Expected: PASS. `test/types/client.test-d.ts` is the regression guard that the extraction changed nothing — in particular its `optionalOnlyQuery` case, which fails to compile if `HasVars` regresses.

- [ ] **Step 6: Commit**

```bash
git add src/types/varargs.ts src/client/client.ts test/types/varargs.test-d.ts
git commit -m "refactor: extract shared variable-arity types for reuse by adapters"
```

---

## Task 2: Document adapter core

The shared machinery every adapter sits on: a `TypedDocumentNode<R, V>` declaration, a memoised parse of the operation's already-printed document, and a kind guard.

**Files:**
- Create: `src/adapters/document.ts`
- Create: `test/unit/adapters.test.ts`
- Create: `test/types/adapters.test-d.ts`
- Modify: `package.json` (devDependencies)

**Interfaces:**
- Consumes: `Operation<R, V>` from `src/runtime/operation.js` — `{ kind, name, document, sels }`.
- Produces:
  - `interface TypedDocumentNode<R, V> extends DocumentNode { __apiType?: (variables: V) => R }`
  - `function toDocument<R, V>(op: Operation<R, V>): TypedDocumentNode<R, V>` — memoised per operation object.
  - `function assertKind(op: Operation<unknown, unknown>, allowed: readonly OperationKind[], helper: string): void`
  - `type OperationKind = 'query' | 'mutation' | 'subscription'`

  Tasks 3 and 4 import all four.

- [ ] **Step 1: Add the types-only devDependency**

Run:

```bash
npm i -D @graphql-typed-document-node/core@^3.2.0
```

This is used **only** by `test/types/adapters.test-d.ts`. It must not appear in `dependencies` or `peerDependencies`.

- [ ] **Step 2: Write the failing runtime test**

Create `test/unit/adapters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { args, leaf, leafArgs, object, objectArgs } from '../../src/runtime/builders.js';
import { makeMutation, makeQuery, makeSubscription } from '../../src/runtime/operation.js';
import { toDocument } from '../../src/adapters/document.js';

const User = {
  id: leaf<'id', ['!'], string>('id', ['!']),
  firstName: leaf<'firstName', ['!'], string>('firstName', ['!']),
};

export const query = makeQuery({
  users: object('users', ['!', 'l', '!'], User),
  user: objectArgs('user', ['!'], User, args<{ id: string }>({ id: 'ID!' })),
});
export const mutation = makeMutation({
  createUser: objectArgs(
    'createUser',
    ['!'],
    User,
    args<{ name: string }>({ name: 'String!' }),
  ),
});
export const subscription = makeSubscription({
  ticks: leafArgs<'ticks', ['!'], string, { room?: string }>(
    'ticks',
    ['!'],
    args<{ room?: string }>({ room: 'String' }),
  ),
});

export const Users = query('Users', ($, Q) => [Q.users((U) => [U.id])]);
export const UserById = query('UserById', ($, Q) => [Q.user({ id: $.id }, (U) => [U.id])]);
export const CreateUser = mutation('CreateUser', ($, M) => [M.createUser({ name: $.name }, (U) => [U.id])]);
export const Ticks = subscription('Ticks', ($, S) => [S.ticks({ room: $.room })]);

describe('toDocument', () => {
  it('parses the operation document into a GraphQL AST', () => {
    const doc = toDocument(Users);
    expect(doc.kind).toBe('Document');
    expect(doc.definitions).toHaveLength(1);
    expect(doc.definitions[0]!.kind).toBe('OperationDefinition');
  });

  it('preserves the operation name and kind', () => {
    const def = toDocument(CreateUser).definitions[0]! as { name?: { value: string }; operation?: string };
    expect(def.name?.value).toBe('CreateUser');
    expect(def.operation).toBe('mutation');
  });

  it('returns the very same AST object on repeated calls', () => {
    // Apollo and urql key their caches on document identity — re-parsing on every
    // render would silently defeat both, so the WeakMap is load-bearing, not a
    // micro-optimisation.
    expect(toDocument(Users)).toBe(toDocument(Users));
  });

  it('returns distinct ASTs for distinct operations', () => {
    expect(toDocument(Users)).not.toBe(toDocument(UserById));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/unit/adapters.test.ts`
Expected: FAIL with `Failed to load url .../src/adapters/document.js`

- [ ] **Step 4: Implement the document core**

Create `src/adapters/document.ts`:

```ts
import { parse } from 'graphql';
import type { DocumentNode } from 'graphql';
import type { Operation } from '../runtime/operation.js';

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
 */
const cache = new WeakMap<Operation<unknown, unknown>, DocumentNode>();

/** The operation's printed document, parsed into a typed GraphQL AST. */
export function toDocument<R, V>(op: Operation<R, V>): TypedDocumentNode<R, V> {
  const hit = cache.get(op);
  if (hit) return hit as TypedDocumentNode<R, V>;
  const doc = parse(op.document);
  cache.set(op, doc);
  return doc as TypedDocumentNode<R, V>;
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/unit/adapters.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Write the interop type test**

Create `test/types/adapters.test-d.ts`:

```ts
import type { TypedDocumentNode as CoreTypedDocumentNode } from '@graphql-typed-document-node/core';
import { args, leaf, object, objectArgs } from '../../src/runtime/builders.js';
import { makeMutation, makeQuery } from '../../src/runtime/operation.js';
import { toDocument } from '../../src/adapters/document.js';

const User = {
  id: leaf<'id', ['!'], string>('id', ['!']),
  firstName: leaf<'firstName', ['!'], string>('firstName', ['!']),
};

const query = makeQuery({
  users: object('users', ['!', 'l', '!'], User),
  user: objectArgs('user', ['!'], User, args<{ id: string }>({ id: 'ID!' })),
});
const mutation = makeMutation({
  createUser: objectArgs('createUser', ['!'], User, args<{ name: string }>({ name: 'String!' })),
});

export const Users = query('Users', ($, Q) => [Q.users((U) => [U.id])]);
export const UserById = query('UserById', ($, Q) => [Q.user({ id: $.id }, (U) => [U.id, U.firstName])]);
export const CreateUser = mutation('CreateUser', ($, M) => [M.createUser({ name: $.name }, (U) => [U.id])]);

// The whole point of the local `TypedDocumentNode` declaration: it must be
// interchangeable with the package Apollo and urql actually build their signatures on.
// Inferring `R`/`V` back out (rather than asserting a hand-written literal) proves both
// that the node is assignable AND that the selected shape survives the round trip.
declare function acceptsCoreDocument<R, V>(doc: CoreTypedDocumentNode<R, V>): [R, V];

const usersProbe = acceptsCoreDocument(toDocument(Users));
const userIds: string[] = usersProbe[0].users.map((u) => u.id);

const byIdProbe = acceptsCoreDocument(toDocument(UserById));
const byIdVar: string = byIdProbe[1].id;
const byIdName: string = byIdProbe[0].user.firstName;

// @ts-expect-error `lastName` was never selected, so it is not on the result type
byIdProbe[0].user.lastName;

export { userIds, byIdVar, byIdName };
```

- [ ] **Step 7: Run the type test to verify it passes**

Run: `npm run test:types`
Expected: PASS

`acceptsCoreDocument` recovers `R` and `V` by inferring through the *optional* `__apiType`
property. If that inference does not land, `R`/`V` resolve to `unknown` and the failure
shows up as `Property 'users' does not exist on type 'unknown'` on the next line — not as
an assignability error. Should that happen, replace the probe with a direct annotated
assignment, which tests assignability without depending on inference:

```ts
const asCore: CoreTypedDocumentNode<{ users: { id: string }[] }, {}> = toDocument(Users);
export { asCore };
```

- [ ] **Step 8: Commit**

```bash
git add src/adapters/document.ts test/unit/adapters.test.ts test/types/adapters.test-d.ts package.json package-lock.json
git commit -m "feat(adapters): memoised TypedDocumentNode conversion for GraphQL operations"
```

---

## Task 3: Apollo Client adapter

**Files:**
- Create: `src/adapters/apollo.ts`
- Modify: `test/unit/adapters.test.ts` (append)
- Modify: `test/types/adapters.test-d.ts` (append)

**Interfaces:**
- Consumes: `toDocument`, `assertKind`, `TypedDocumentNode` from `src/adapters/document.js`; `VarsArg` from `src/types/varargs.js`; `Operation` from `src/runtime/operation.js`.
- Produces (published as `buildql/adapters/apollo` in Task 6):
  - `interface ApolloQueryArgs<R, V> { readonly query: TypedDocumentNode<R, V>; readonly variables: V }`
  - `interface ApolloMutationArgs<R, V> { readonly mutation: TypedDocumentNode<R, V>; readonly variables: V }`
  - `function apolloDocument<R, V>(op: Operation<R, V>): TypedDocumentNode<R, V>`
  - `function toApolloQuery<R, V>(op: Operation<R, V>, ...rest: VarsArg<V>): ApolloQueryArgs<R, V>`
  - `function toApolloMutation<R, V>(op: Operation<R, V>, ...rest: VarsArg<V>): ApolloMutationArgs<R, V>`

  Task 5 emits these three function names into the generated module for `client: 'apollo'`.

- [ ] **Step 1: Write the failing runtime tests**

Append to `test/unit/adapters.test.ts` (the fixtures from Task 2 are already at the top of the file). Add the import to the existing import block:

```ts
import { apolloDocument, toApolloMutation, toApolloQuery } from '../../src/adapters/apollo.js';
```

Then append:

```ts
describe('apollo adapter', () => {
  it('apolloDocument returns the shared, memoised AST', () => {
    expect(apolloDocument(Users)).toBe(toDocument(Users));
  });

  it('toApolloQuery produces client.query() options', () => {
    const opts = toApolloQuery(UserById, { id: '7' });
    expect(opts).toEqual({ query: toDocument(UserById), variables: { id: '7' } });
  });

  it('defaults variables to an empty object when the operation declares none', () => {
    // Matches `client.execute`, which also sends `variables: {}` rather than omitting
    // the key — Apollo uses `variables` for cache keying, and `undefined` vs `{}` would
    // make buildql's two client paths disagree about the same operation.
    expect(toApolloQuery(Users).variables).toEqual({});
  });

  it('toApolloQuery accepts a subscription, since client.subscribe() also takes { query }', () => {
    expect(toApolloQuery(Ticks, { room: 'lobby' }).query).toBe(toDocument(Ticks));
  });

  it('toApolloMutation produces client.mutate() options under the `mutation` key', () => {
    const opts = toApolloMutation(CreateUser, { name: 'Ada' });
    expect(opts).toEqual({ mutation: toDocument(CreateUser), variables: { name: 'Ada' } });
  });

  it('rejects a query passed to toApolloMutation', () => {
    expect(() => toApolloMutation(Users as never)).toThrow(
      /buildql: toApolloMutation\(\) expects a mutation operation, but "Users" is a query/,
    );
  });

  it('rejects a mutation passed to toApolloQuery', () => {
    expect(() => toApolloQuery(CreateUser as never)).toThrow(
      /buildql: toApolloQuery\(\) expects a query or subscription operation, but "CreateUser" is a mutation/,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/adapters.test.ts`
Expected: FAIL with `Failed to load url .../src/adapters/apollo.js`

- [ ] **Step 3: Implement the Apollo adapter**

Create `src/adapters/apollo.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit/adapters.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Write the Apollo type test**

Append to `test/types/adapters.test-d.ts`. Add to the imports:

```ts
import { apolloDocument, toApolloMutation, toApolloQuery } from '../../src/adapters/apollo.js';
```

Then append:

```ts
// Apollo's own types are not a devDependency (see the plan's design notes: they are heavy
// and have restructured their entry points across majors). These mirror the public
// signatures of `ApolloClient#query`, `#mutate` and `useQuery` closely enough to prove the
// adapter's return values drop straight in; the phantom contract they all rely on is
// tested for real against @graphql-typed-document-node/core above.
declare function apolloQuery<TData, TVariables>(
  options: { query: CoreTypedDocumentNode<TData, TVariables>; variables?: TVariables },
): Promise<{ data: TData }>;
declare function apolloMutate<TData, TVariables>(
  options: { mutation: CoreTypedDocumentNode<TData, TVariables>; variables?: TVariables },
): Promise<{ data: TData }>;
declare function apolloUseQuery<TData, TVariables>(
  document: CoreTypedDocumentNode<TData, TVariables>,
  options?: { variables?: TVariables },
): { data: TData | undefined };

async function apolloUsage() {
  const q = await apolloQuery(toApolloQuery(UserById, { id: '7' }));
  const name: string = q.data.user.firstName;

  const m = await apolloMutate(toApolloMutation(CreateUser, { name: 'Ada' }));
  const created: string = m.data.createUser.id;

  const hook = apolloUseQuery(apolloDocument(UserById), { variables: { id: '7' } });
  const hookName: string | undefined = hook.data?.user.firstName;

  // @ts-expect-error missing required variable
  toApolloQuery(UserById);
  // @ts-expect-error wrong variable type
  toApolloQuery(UserById, { id: 7 });
  // @ts-expect-error unknown variable
  toApolloQuery(UserById, { id: '7', extra: true });

  // An operation with no variables needs no second argument at all.
  const none = toApolloQuery(Users);

  return { name, created, hookName, none };
}

export { apolloUsage };
```

- [ ] **Step 6: Run the type test to verify it passes**

Run: `npm run test:types`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/adapters/apollo.ts test/unit/adapters.test.ts test/types/adapters.test-d.ts
git commit -m "feat(adapters): Apollo Client adapter"
```

---

## Task 4: urql adapter

**Files:**
- Create: `src/adapters/urql.ts`
- Modify: `test/unit/adapters.test.ts` (append)
- Modify: `test/types/adapters.test-d.ts` (append)

**Interfaces:**
- Consumes: `toDocument`, `TypedDocumentNode` from `src/adapters/document.js`; `VarsArg` from `src/types/varargs.js`; `Operation` from `src/runtime/operation.js`. (No `assertKind` — urql is kind-agnostic.)
- Produces (published as `buildql/adapters/urql` in Task 6):
  - `interface UrqlArgs<R, V> { readonly query: TypedDocumentNode<R, V>; readonly variables: V }`
  - `function urqlDocument<R, V>(op: Operation<R, V>): TypedDocumentNode<R, V>`
  - `function toUrqlArgs<R, V>(op: Operation<R, V>, ...rest: VarsArg<V>): UrqlArgs<R, V>`

  Task 5 emits these two function names into the generated module for `client: 'urql'`.

- [ ] **Step 1: Write the failing runtime tests**

Append to `test/unit/adapters.test.ts`. Add to the import block:

```ts
import { toUrqlArgs, urqlDocument } from '../../src/adapters/urql.js';
```

Then append:

```ts
describe('urql adapter', () => {
  it('urqlDocument returns the shared, memoised AST', () => {
    expect(urqlDocument(Users)).toBe(toDocument(Users));
  });

  it('toUrqlArgs produces useQuery() arguments', () => {
    expect(toUrqlArgs(UserById, { id: '7' })).toEqual({
      query: toDocument(UserById),
      variables: { id: '7' },
    });
  });

  it('defaults variables to an empty object', () => {
    expect(toUrqlArgs(Users).variables).toEqual({});
  });

  it('accepts every operation kind, because urql keys all three off `query`', () => {
    // Unlike Apollo, urql's useQuery/useMutation/useSubscription and the equivalent
    // client methods all take the document under `query` — so there is nothing here that
    // a kind guard could catch.
    expect(toUrqlArgs(CreateUser, { name: 'Ada' }).query).toBe(toDocument(CreateUser));
    expect(toUrqlArgs(Ticks).query).toBe(toDocument(Ticks));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/adapters.test.ts`
Expected: FAIL with `Failed to load url .../src/adapters/urql.js`

- [ ] **Step 3: Implement the urql adapter**

Create `src/adapters/urql.ts`:

```ts
import type { Operation } from '../runtime/operation.js';
import type { VarsArg } from '../types/varargs.js';
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/unit/adapters.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 5: Write the urql type test**

Append to `test/types/adapters.test-d.ts`. Add to the imports:

```ts
import { toUrqlArgs, urqlDocument } from '../../src/adapters/urql.js';
```

Then append:

```ts
// Mirrors urql's `Client#query`, `Client#mutation` and `useQuery` signatures. urql types
// its document parameter as `DocumentInput<Data, Variables>`, which resolves to
// `TypedDocumentNode<Data, Variables>` for a typed node — the case pinned here.
declare function urqlClientQuery<TData, TVariables>(
  query: CoreTypedDocumentNode<TData, TVariables>,
  variables: TVariables,
): Promise<{ data?: TData }>;
declare function urqlUseQuery<TData, TVariables>(
  args: { query: CoreTypedDocumentNode<TData, TVariables>; variables?: TVariables },
): [{ data?: TData }];

async function urqlUsage() {
  const [res] = urqlUseQuery(toUrqlArgs(UserById, { id: '7' }));
  const name: string | undefined = res.data?.user.firstName;

  const direct = await urqlClientQuery(urqlDocument(UserById), { id: '7' });
  const directName: string | undefined = direct.data?.user.firstName;

  // @ts-expect-error missing required variable
  toUrqlArgs(UserById);
  // @ts-expect-error wrong variable type
  toUrqlArgs(UserById, { id: 7 });
  // @ts-expect-error unknown variable
  toUrqlArgs(UserById, { id: '7', extra: true });

  const none = toUrqlArgs(Users);

  return { name, directName, none };
}

export { urqlUsage };
```

- [ ] **Step 6: Run the full check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/adapters/urql.ts test/unit/adapters.test.ts test/types/adapters.test-d.ts
git commit -m "feat(adapters): urql adapter"
```

---

## Task 5: Client registry and emitter support

Teaches the code generator which client the generated module should bind to. The registry is a standalone module so the config validator (Task 6) and the emitter agree on the list of valid values without either importing the other.

**Files:**
- Create: `src/codegen/clients.ts`
- Modify: `src/codegen/emit.ts:9-31` and `:163-184`
- Modify: `test/unit/emit.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `type ClientKind = 'buildql' | 'apollo' | 'urql' | 'none'`
  - `const CLIENT_KINDS: readonly ['buildql', 'apollo', 'urql', 'none']`
  - `interface ClientEmit { readonly module?: string; readonly names: readonly string[] }`
  - `const CLIENT_EMITS: Record<ClientKind, ClientEmit>`
  - `function isClientKind(value: unknown): value is ClientKind`
  - `emit(ir: IRSchema, client?: ClientKind): string` — second parameter defaults to `'buildql'`.

  Task 6 imports `CLIENT_KINDS`/`isClientKind` for validation and `CLIENT_EMITS` for the CLI hint.

- [ ] **Step 1: Write the failing emitter tests**

Append to `test/unit/emit.test.ts`:

```ts
describe('emit — client option', () => {
  it('defaults to buildql: imports and re-exports createClient', async () => {
    const src = await generated();
    expect(src).toContain('  createClient,\n');
    expect(src).toContain('export { $, v, on, spread, include, skip, createClient };');
    expect(src).not.toContain('buildql/adapters');
  });

  it('emits the apollo adapter imports and re-exports', async () => {
    const src = emit(buildIR(await loadSchema(sdlPath)), 'apollo');
    expect(src).toContain(
      "import { apolloDocument, toApolloMutation, toApolloQuery } from 'buildql/adapters/apollo';",
    );
    expect(src).toContain(
      'export { $, v, on, spread, include, skip, apolloDocument, toApolloMutation, toApolloQuery };',
    );
    // buildql's own client must not be bound in when another one was chosen.
    expect(src).not.toContain('createClient');
  });

  it('emits the urql adapter imports and re-exports', async () => {
    const src = emit(buildIR(await loadSchema(sdlPath)), 'urql');
    expect(src).toContain("import { toUrqlArgs, urqlDocument } from 'buildql/adapters/urql';");
    expect(src).toContain('export { $, v, on, spread, include, skip, toUrqlArgs, urqlDocument };');
    expect(src).not.toContain('createClient');
  });

  it('binds no client at all for "none"', async () => {
    const src = emit(buildIR(await loadSchema(sdlPath)), 'none');
    expect(src).toContain('export { $, v, on, spread, include, skip };');
    expect(src).not.toContain('createClient');
    expect(src).not.toContain('buildql/adapters');
  });

  it('still emits the runtime builders and the Operation type re-export for every client', async () => {
    for (const client of ['buildql', 'apollo', 'urql', 'none'] as const) {
      const src = emit(buildIR(await loadSchema(sdlPath)), client);
      expect(src).toContain('  makeQuery,\n');
      expect(src).toContain("export type { Operation } from 'buildql';");
      expect(src).toContain('export const query = makeQuery(Query)');
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/emit.test.ts`
Expected: FAIL — `emit()` takes one argument, so `emit(ir, 'apollo')` is a TS error at runtime-transpile time and the apollo/urql/none assertions do not hold.

- [ ] **Step 3: Create the client registry**

Create `src/codegen/clients.ts`:

```ts
/** Which GraphQL client the generated module binds to. */
export type ClientKind = 'buildql' | 'apollo' | 'urql' | 'none';

export const CLIENT_KINDS = ['buildql', 'apollo', 'urql', 'none'] as const satisfies readonly ClientKind[];

export interface ClientEmit {
  /** Module the generated file imports the client bindings from. Absent for `'none'`. */
  readonly module?: string;
  /** Names imported from `module` — also exactly the names re-exported. Keep sorted. */
  readonly names: readonly string[];
}

/**
 * Single source of truth for what each client contributes to the generated module. The
 * config validator and the emitter both read it, so adding a client is a one-entry change
 * here plus an adapter module.
 */
export const CLIENT_EMITS: Record<ClientKind, ClientEmit> = {
  buildql: { module: 'buildql', names: ['createClient'] },
  apollo: {
    module: 'buildql/adapters/apollo',
    names: ['apolloDocument', 'toApolloMutation', 'toApolloQuery'],
  },
  urql: { module: 'buildql/adapters/urql', names: ['toUrqlArgs', 'urqlDocument'] },
  none: { names: [] },
};

export function isClientKind(value: unknown): value is ClientKind {
  return typeof value === 'string' && (CLIENT_KINDS as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Make the emitter client-aware**

In `src/codegen/emit.ts`, add to the imports at the top:

```ts
import { CLIENT_EMITS } from './clients.js';
import type { ClientKind } from './clients.js';
```

Replace the `IMPORTS` and `REEXPORTS` consts (lines 9-31) with:

```ts
/** Names the generated module always pulls from the package root. */
const CORE_IMPORTS = [
  'args',
  'include',
  'leaf',
  'leafArgs',
  'makeFragment',
  'makeMutation',
  'makeQuery',
  'makeSubscription',
  'object',
  'objectArgs',
  'on',
  'skip',
  'spread',
];

/**
 * Client names that come from the package root itself (`createClient`) are merged into the
 * single root import and re-sorted rather than emitted as a second `from 'buildql'` line,
 * so the default output stays byte-identical to what buildql generated before this option
 * existed. `$` and `v` stay pinned to the end of the list, as they always were.
 */
function importBlock(client: ClientKind): string {
  const { module, names } = CLIENT_EMITS[client];
  const fromRoot = module === 'buildql' ? [...CORE_IMPORTS, ...names].sort() : [...CORE_IMPORTS].sort();
  const root = `import {\n${fromRoot.map((n) => `  ${n},`).join('\n')}\n  $,\n  v,\n} from 'buildql';\n`;
  if (!module || module === 'buildql') return root;
  return `${root}import { ${names.join(', ')} } from '${module}';\n`;
}

function reexportBlock(client: ClientKind): string {
  const list = ['$', 'v', 'on', 'spread', 'include', 'skip', ...CLIENT_EMITS[client].names];
  return `export { ${list.join(', ')} };\nexport type { Operation } from 'buildql';\n`;
}
```

Then change `emit` (lines 163-164 and 182) to:

```ts
export function emit(ir: IRSchema, client: ClientKind = 'buildql'): string {
  const parts: string[] = [HEADER, importBlock(client)];
```

and, at the end of the function, replace `parts.push(REEXPORTS);` with:

```ts
  parts.push(reexportBlock(client));
```

- [ ] **Step 5: Run the emitter tests to verify they pass**

Run: `npx vitest run test/unit/emit.test.ts`
Expected: PASS — including every pre-existing test, which is the byte-identical-default guard.

- [ ] **Step 6: Run the full check**

Run: `npm run check`
Expected: PASS. `test/e2e/generate-and-run.test.ts` compiles and executes the default generated module, so a drift in the import block fails here too.

- [ ] **Step 7: Commit**

```bash
git add src/codegen/clients.ts src/codegen/emit.ts test/unit/emit.test.ts
git commit -m "feat(codegen): bind the generated module to a configurable GraphQL client"
```

---

## Task 6: Config field and CLI plumbing

**Files:**
- Modify: `src/cli/config.ts:5-14` (the `BuildQLConfig` interface) and `:69-85` (`assertBuildQLConfig`)
- Modify: `src/cli/index.ts:12-37` (`generate`)
- Modify: `test/unit/config.test.ts` (append)
- Modify: `test/unit/cli.test.ts` (append)

**Interfaces:**
- Consumes: `ClientKind`, `CLIENT_KINDS`, `CLIENT_EMITS`, `isClientKind` from `src/codegen/clients.js`; `emit(ir, client)` from `src/codegen/emit.js`.
- Produces: `BuildQLConfig.client?: ClientKind`; `src/cli/config.ts` re-exports `ClientKind` so `defineConfig` users get the union in their editor.

- [ ] **Step 1: Write the failing config tests**

Append to `test/unit/config.test.ts`, inside the existing `describe('loadConfig', ...)` block:

```ts
  it('accepts a valid client', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(
      join(dir, 'buildql.config.mjs'),
      "export default { schema: './schema.graphql', client: 'apollo' };\n",
    );
    const { config } = await loadConfig(dir);
    expect(config.client).toBe('apollo');
  });

  it('leaves client undefined when it is not set', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(join(dir, 'buildql.config.mjs'), "export default { schema: './schema.graphql' };\n");
    const { config } = await loadConfig(dir);
    expect(config.client).toBeUndefined();
  });

  it('errors clearly on an unknown client, naming the valid values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(
      join(dir, 'buildql.config.mjs'),
      "export default { schema: './schema.graphql', client: 'relay' };\n",
    );
    await expect(loadConfig(dir)).rejects.toThrow(
      /buildql:.*"client" must be one of "buildql", "apollo", "urql", "none"/,
    );
  });

  it('errors clearly when client is not a string', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
    await writeFile(
      join(dir, 'buildql.config.mjs'),
      "export default { schema: './schema.graphql', client: 42 };\n",
    );
    await expect(loadConfig(dir)).rejects.toThrow(/buildql:.*"client"/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/config.test.ts`
Expected: FAIL — `config.client` is `undefined` for the apollo case (the property is not on the type), and neither invalid-value case throws.

- [ ] **Step 3: Add the config field and its validation**

In `src/cli/config.ts`, add to the imports at the top:

```ts
import { CLIENT_KINDS, isClientKind } from '../codegen/clients.js';
import type { ClientKind } from '../codegen/clients.js';

export type { ClientKind } from '../codegen/clients.js';
```

Add the field to `BuildQLConfig`, after `scalars`:

```ts
  /**
   * Which GraphQL client the generated module binds to. `'buildql'` (the default) re-exports
   * buildql's own `createClient`; `'apollo'` and `'urql'` re-export that client's adapter
   * instead; `'none'` binds no client at all. Adapters require the `graphql` package.
   */
  readonly client?: ClientKind;
```

Add the check to `assertBuildQLConfig`, after the `scalars` check:

```ts
  if (value.client !== undefined && !isClientKind(value.client)) {
    throw new Error(
      `buildql: ${name}'s "client" must be one of ${CLIENT_KINDS.map((k) => `"${k}"`).join(', ')}`,
    );
  }
```

- [ ] **Step 4: Run the config tests to verify they pass**

Run: `npx vitest run test/unit/config.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing CLI test**

Append to `test/unit/cli.test.ts`:

```ts
it('generates a module bound to the configured client', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  const out = await generate({ schema: './schema.graphql', output: '.', client: 'urql' }, dir);
  const src = await readFile(out, 'utf8');
  expect(src).toContain("import { toUrqlArgs, urqlDocument } from 'buildql/adapters/urql';");
  expect(src).not.toContain('createClient');
});

it('tells the user which adapter names the generated module now re-exports', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  await generate({ schema: './schema.graphql', output: '.', client: 'apollo' }, dir);
  expect(written(stdoutSpy)).toMatch(
    /buildql: client "apollo" — the generated module re-exports apolloDocument, toApolloMutation, toApolloQuery from buildql\/adapters\/apollo \(requires the "graphql" package\)/,
  );
});

it('says nothing about adapters for the default client', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  await generate({ schema: './schema.graphql', output: '.' }, dir);
  expect(written(stdoutSpy)).not.toContain('buildql/adapters');
});
```

- [ ] **Step 6: Run the CLI test to verify it fails**

Run: `npx vitest run test/unit/cli.test.ts`
Expected: FAIL — the generated file still imports `createClient`, and no hint is written to stdout.

- [ ] **Step 7: Plumb the client through the CLI**

In `src/cli/index.ts`, add to the imports:

```ts
import { CLIENT_EMITS } from '../codegen/clients.js';
```

In `generate`, replace `const src = emit(ir);` with:

```ts
  const client = config.client ?? 'buildql';
  const { module, names } = CLIENT_EMITS[client];
  if (module && module !== 'buildql') {
    process.stdout.write(
      `buildql: client "${client}" — the generated module re-exports ${names.join(', ')} ` +
        `from ${module} (requires the "graphql" package)\n`,
    );
  }

  const src = emit(ir, client);
```

- [ ] **Step 8: Run the CLI test to verify it passes**

Run: `npx vitest run test/unit/cli.test.ts`
Expected: PASS

- [ ] **Step 9: Run the full check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/cli/config.ts src/cli/index.ts test/unit/config.test.ts test/unit/cli.test.ts
git commit -m "feat(config): add the \"client\" option and wire it through the CLI"
```

---

## Task 7: Package entry points

Publishes the two adapters as importable subpaths. Without this, the module specifiers the generator now emits do not resolve for installed users.

**Files:**
- Modify: `tsup.config.ts`
- Modify: `package.json` (`exports`, `typesVersions`)

**Interfaces:**
- Consumes: `src/adapters/apollo.ts`, `src/adapters/urql.ts`.
- Produces: resolvable `buildql/adapters/apollo` and `buildql/adapters/urql` specifiers, matching what `CLIENT_EMITS` emits.

- [ ] **Step 1: Add the tsup entries**

In `tsup.config.ts`, extend the `entry` array:

```ts
  entry: [
    'src/index.ts',
    'src/client/client.ts',
    'src/cli/config.ts',
    'src/cli/index.ts',
    'src/adapters/apollo.ts',
    'src/adapters/urql.ts',
  ],
```

`graphql` is a peer dependency, so tsup externalises it automatically — the built adapters must not bundle it.

- [ ] **Step 2: Add the export map entries**

In `package.json`, add to `exports` after the `"./config"` entry:

```json
    "./adapters/apollo": { "types": "./dist/adapters/apollo.d.ts", "import": "./dist/adapters/apollo.js", "require": "./dist/adapters/apollo.cjs" },
    "./adapters/urql": { "types": "./dist/adapters/urql.d.ts", "import": "./dist/adapters/urql.js", "require": "./dist/adapters/urql.cjs" }
```

And to `typesVersions["*"]`:

```json
      "adapters/apollo": ["./dist/adapters/apollo.d.ts"],
      "adapters/urql": ["./dist/adapters/urql.d.ts"]
```

- [ ] **Step 3: Build and verify the artifacts exist**

Run:

```bash
npm run build && ls dist/adapters
```

Expected: `apollo.cjs  apollo.d.cts  apollo.d.ts  apollo.js  urql.cjs  urql.d.cts  urql.d.ts  urql.js`

- [ ] **Step 4: Verify the subpaths resolve and `graphql` was not bundled**

Run:

```bash
node -e "import('./dist/adapters/apollo.js').then(m => console.log(Object.keys(m).sort().join(',')))"
node -e "import('./dist/adapters/urql.js').then(m => console.log(Object.keys(m).sort().join(',')))"
grep -cE "(from|require\()[\"']graphql[\"']" dist/adapters/apollo.js dist/adapters/apollo.cjs
```

Expected:
```
apolloDocument,toApolloMutation,toApolloQuery
toUrqlArgs,urqlDocument
dist/adapters/apollo.js:1
dist/adapters/apollo.cjs:1
```
A `grep` count of `0` would mean `graphql` was inlined into the bundle instead of left
external — that is a failure.

- [ ] **Step 5: Confirm the root entry is still graphql-free**

Run:

```bash
grep -cE "(from|require\()[\"']graphql[\"']" dist/index.js dist/index.cjs || echo "clean — no graphql import in the root entry"
```

Expected: `clean — no graphql import in the root entry`.

Match the import specifier, not the bare word: `dist/index.js` legitimately contains
`GraphQLResponseError` and `GraphQLFormattedError`, so a plain `grep graphql` would
report a false positive.

- [ ] **Step 6: Commit**

```bash
git add package.json tsup.config.ts
git commit -m "build: publish buildql/adapters/apollo and buildql/adapters/urql entry points"
```

---

## Task 8: End-to-end generation against a live schema

Proves a `client: 'urql'` generated module type-checks under strict `tsc` and its operations execute against a real server — the same bar the default client is already held to.

**Files:**
- Modify: `test/e2e/generate-and-run.test.ts`

**Interfaces:**
- Consumes: `generate` from `src/cli/index.js`; `startServer` from `test/e2e/fixtures/server.js`; `toUrqlArgs` from `src/adapters/urql.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing e2e test**

Append to `test/e2e/generate-and-run.test.ts`. This mirrors the existing default-client
harness: generate into a temp dir, patch the unresolvable package specifiers, write a
`usage.ts` and a `tsconfig.json`, run the real `tsc` over both, then import and execute.

```ts
it('generates a urql-bound module that type-checks under strict mode and runs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-e2e-urql-'));
  const file = await generate({ schema: server.url, output: '.', client: 'urql' }, dir);

  // Neither `buildql` nor `buildql/adapters/urql` resolves from a throwaway temp
  // directory, so both runtime imports are rewritten to this project's own sources. The
  // two quoted specifiers are distinct strings, so a single `.replace` each is enough and
  // the order between them does not matter. As in the default-client case above, the
  // trailing type-only `export type { Operation } from 'buildql'` is erased at runtime and
  // is resolved for `tsc` by the `paths` mapping below instead.
  const adapterPath = new URL('../../src/adapters/urql.ts', import.meta.url).pathname;
  const patched = (await readFile(file, 'utf8'))
    .replace("from 'buildql/adapters/urql'", `from '${adapterPath}'`)
    .replace("from 'buildql'", `from '${srcIndexPath}'`);
  await writeFile(file, patched);

  const urqlUsageFile = join(dir, 'usage.ts');
  await writeFile(
    urqlUsageFile,
    `import { query, toUrqlArgs, urqlDocument } from './index.js';

export const q = query('Posts', ($, Q) => [Q.posts((P) => [P.id, P.title])]);

// \`postsByStatus(status: Status!)\` is required in the fixture schema, so this operation
// has a required \`status\` variable of the generated \`Status\` union.
export const byStatus = query('PostsByStatus', ($, Q) => [
  Q.postsByStatus({ status: $.status }, (P) => [P.id, P.title, P.status]),
]);

export const withVars = toUrqlArgs(byStatus, { status: 'PUBLISHED' });
export const noVars = toUrqlArgs(q);
export const doc = urqlDocument(q);

// The adapter must carry the INFERRED variables through, not widen them to a record —
// a plain DocumentNode would still compile everywhere else in this file.
export const status: 'DRAFT' | 'PUBLISHED' = withVars.variables.status;

// @ts-expect-error the operation declares a required \`status\` variable
toUrqlArgs(byStatus);
// @ts-expect-error wrong variable type
toUrqlArgs(byStatus, { status: 'ARCHIVED' });
`,
  );

  await writeFile(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        paths: { buildql: [srcIndexPath] },
      },
      include: ['index.ts', 'usage.ts'],
    }),
  );

  const tsc = new URL('../../node_modules/typescript/bin/tsc', import.meta.url).pathname;
  await expect(run(process.execPath, [tsc, '-p', join(dir, 'tsconfig.json')])).resolves.toBeTruthy();

  type PostsResult = { posts: { id: string; title: string }[] };
  type ByStatusResult = { postsByStatus: { id: string; title: string; status: 'DRAFT' | 'PUBLISHED' }[] };

  const mod = (await import(pathToFileURL(urqlUsageFile).href)) as {
    readonly q: Operation<PostsResult, {}>;
    readonly byStatus: Operation<ByStatusResult, { status: 'DRAFT' | 'PUBLISHED' }>;
    readonly withVars: { query: { kind: string; definitions: readonly unknown[] }; variables: { status: string } };
    readonly noVars: { query: { kind: string }; variables: Record<string, never> };
    readonly doc: { kind: string };
  };

  // The adapter produced a real parsed AST, and the same one for the same operation.
  expect(mod.noVars.query.kind).toBe('Document');
  expect(mod.doc).toBe(mod.noVars.query);
  expect(mod.noVars.variables).toEqual({});
  expect(mod.withVars.variables).toEqual({ status: 'PUBLISHED' });
  expect(mod.withVars.query.definitions).toHaveLength(1);

  // The generated module binds urql and NOT buildql's own client.
  const generated = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  expect(typeof generated.toUrqlArgs).toBe('function');
  expect(typeof generated.urqlDocument).toBe('function');
  expect(generated.createClient).toBeUndefined();

  // The document the adapter handed to urql is still the one the server accepts —
  // executing it through buildql's client proves the adapter changed nothing but the form.
  const client = createClient({ url: server.url });
  expect(await client.execute(mod.byStatus, { status: 'PUBLISHED' })).toEqual({
    postsByStatus: [{ id: 'p1', title: 'Hello', status: 'PUBLISHED' }],
  });
}, 60_000);
```

- [ ] **Step 2: Run the e2e test to verify it fails**

Run: `npx vitest run test/e2e/generate-and-run.test.ts`
Expected: PASS if Tasks 5-7 all landed correctly — this is an integration regression test, so it does not drive new production code.

Confirm it genuinely exercises the new path before trusting it: temporarily change
`client: 'urql'` to `client: 'buildql'` in the `generate(...)` call and re-run. Expected:
FAIL, because the generated module no longer exports `toUrqlArgs` and `usage.ts` fails to
compile under `tsc`. Change it back and re-run to confirm PASS.

- [ ] **Step 3: Run the full check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add test/e2e/generate-and-run.test.ts
git commit -m "test(e2e): generate and run a urql-bound module against a live schema"
```

---

## Task 9: Documentation

**Files:**
- Modify: `README.md` — the `## Configure` section, plus two new sections and a Requirements bullet.

**Interfaces:**
- Consumes: the public API from Tasks 3, 4 and 6.
- Produces: nothing.

- [ ] **Step 1: Document the config option**

In `README.md`, in the `defineConfig({...})` example under `## Configure`, add a line after `scalars`:

```js
  scalars: { DateTime: 'string', JSON: 'unknown' },

  // 'buildql' (default) | 'apollo' | 'urql' | 'none' — see "Using Apollo or urql"
  client: 'buildql',
```

- [ ] **Step 2: Add the adapters section**

Insert a new section immediately before `## Requirements`:

````markdown
## Using Apollo or urql

buildql's own `createClient` is the default, but the generated operations are just
documents plus inferred types — they run through any GraphQL client. Set `client`
in your config and the generated module re-exports that client's adapter instead
of `createClient`:

```js
export default defineConfig({
  schema: 'https://api.example.com/graphql',
  client: 'apollo', // or 'urql'
});
```

**Apollo Client:**

```ts
import { query, $, apolloDocument, toApolloQuery, toApolloMutation } from './src/gql';
import { useQuery } from '@apollo/client';

const UserById = query('UserById', ($, Q) => [Q.user({ id: $.id }, (U) => [U.id, U.firstName])]);

// Imperative API — the adapter returns Apollo's options object verbatim.
const { data } = await apolloClient.query(toApolloQuery(UserById, { id: '7' }));
//      ^? { user: { id: string; firstName: string } }

await apolloClient.mutate(toApolloMutation(CreateUser, { name: 'Ada' }));

// Hooks take the document positionally, so pass `apolloDocument(...)`.
const { data } = useQuery(apolloDocument(UserById), { variables: { id: '7' } });
```

`toApolloQuery` also covers `client.watchQuery()` and `client.subscribe()`, which
take the same `{ query, variables }` shape. Passing a mutation to `toApolloQuery`
(or a query to `toApolloMutation`) throws — Apollo keys those options differently.

**urql:**

```ts
import { query, $, toUrqlArgs, urqlDocument } from './src/gql';
import { useQuery, useMutation } from 'urql';

// urql uses `{ query, variables }` for queries, mutations and subscriptions alike.
const [result] = useQuery(toUrqlArgs(UserById, { id: '7' }));
//     ^? { data?: { user: { id: string; firstName: string } } }

const [, createUser] = useMutation(urqlDocument(CreateUser));
await urqlClient.query(urqlDocument(UserById), { id: '7' });
```

Both adapters return a `TypedDocumentNode<Result, Variables>` — the same phantom-typed
node Apollo and urql already understand — so `data` and `variables` are typed
end-to-end with no extra generics at the call site.

Variables follow the same rule as `client.execute`: required schema arguments make the
`vars` argument mandatory, all-optional ones make it omissible.

You can also import the adapters directly without touching your config:

```ts
import { toApolloQuery } from 'buildql/adapters/apollo';
import { toUrqlArgs } from 'buildql/adapters/urql';
```

Adapters need the `graphql` package installed — they parse the printed document into
the AST these clients require. Setting `client: 'none'` binds no client at all, if you
want to wire one up yourself.

## Relay

Relay is **not** supported, and no adapter is planned.

Relay's store does not consume GraphQL documents at runtime. It requires
`ConcreteRequest` artifacts emitted ahead of time by relay-compiler — a normalization
AST, hashed identifiers, and a fragment-per-component model that the compiler derives
from source files it has scanned. buildql builds its documents at runtime from
TypeScript selections, so there is nothing for relay-compiler to read and nothing for
the store to normalize against.

If you use Relay, use its own compiler. buildql and Relay solve the same problem in
incompatible ways.
````

- [ ] **Step 3: Update the Requirements section**

In `## Requirements`, replace the `graphql` bullet with:

```markdown
- `graphql` if you point `schema` at an SDL file, **or** if you use an Apollo/urql
  adapter (`client: 'apollo' | 'urql'`, or a direct `buildql/adapters/*` import) —
  the adapters parse the printed document into the AST those clients expect. URL and
  `.json` introspection sources with the default client need no extra dependency.
```

- [ ] **Step 4: Verify every code sample in the new sections type-checks**

The README samples are not compiled by CI. Re-read the "Using Apollo or urql" section against the actual exported signatures from `src/adapters/apollo.ts` and `src/adapters/urql.ts` and confirm each name and argument order matches. In particular: `apolloDocument`, `toApolloQuery`, `toApolloMutation`, `toUrqlArgs`, `urqlDocument`, and that the adapter names shown match `CLIENT_EMITS` in `src/codegen/clients.ts`.

- [ ] **Step 5: Run the full check**

Run: `npm run check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: Apollo and urql adapters; explain why Relay is out of scope"
```

---

## Verification

After all tasks, the following must hold:

```bash
npm run check   # test:types + test + test:perf
npm run build   # dist/adapters/{apollo,urql}.{js,cjs,d.ts} present
```

- `emit(ir)` with no second argument produces output byte-identical to before this change.
- `dist/index.js` contains no reference to `graphql`.
- `dist/adapters/apollo.js` imports `graphql` rather than bundling it.
- `@apollo/client`, `@urql/core` and `@graphql-typed-document-node/core` appear nowhere in `dependencies` or `peerDependencies` (`@graphql-typed-document-node/core` is a devDependency only).
