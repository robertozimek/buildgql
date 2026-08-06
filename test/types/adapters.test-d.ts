import type { TypedDocumentNode as CoreTypedDocumentNode } from '@graphql-typed-document-node/core';
import { argSpec, leafField, objectField, objectFieldArgs } from '../../src/runtime/builders.js';
import { makeMutation, makeQuery } from '../../src/runtime/operation.js';
import { toDocument } from '../../src/adapters/document.js';
import { apolloDocument, toApolloMutation, toApolloQuery } from '../../src/adapters/apollo.js';
import { toUrqlArgs, urqlDocument } from '../../src/adapters/urql.js';

const User = {
  id: leafField<'id', ['!'], string>('id', ['!']),
  firstName: leafField<'firstName', ['!'], string>('firstName', ['!']),
};

const query = makeQuery({
  users: objectField('users', ['!', 'l', '!'], User),
  user: objectFieldArgs('user', ['!'], User, argSpec<{ id: string }>({ id: 'ID!' })),
});
const mutation = makeMutation({
  createUser: objectFieldArgs('createUser', ['!'], User, argSpec<{ name: string }>({ name: 'String!' })),
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

// Apollo's own types are not a devDependency (see the plan's design notes: they are heavy
// and have restructured their entry points across majors). These mirror the public
// signatures of `ApolloClient#query`, `#mutate` and `useQuery` closely enough to prove the
// adapter's return values drop straight in; the phantom contract they all rely on is
// tested for real against @graphql-typed-document-node/core above.
declare function apolloQuery<TData, TVariables>(options: {
  query: CoreTypedDocumentNode<TData, TVariables>;
  variables?: TVariables;
}): Promise<{ data: TData }>;
declare function apolloMutate<TData, TVariables>(options: {
  mutation: CoreTypedDocumentNode<TData, TVariables>;
  variables?: TVariables;
}): Promise<{ data: TData }>;
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

// Mirrors urql's `Client#query`, `Client#mutation` and `useQuery` signatures. urql types
// its document parameter as `DocumentInput<Data, Variables>`, which resolves to
// `TypedDocumentNode<Data, Variables>` for a typed node — the case pinned here.
declare function urqlClientQuery<TData, TVariables>(
  query: CoreTypedDocumentNode<TData, TVariables>,
  variables: TVariables,
): Promise<{ data?: TData }>;
declare function urqlUseQuery<TData, TVariables>(args: {
  query: CoreTypedDocumentNode<TData, TVariables>;
  variables?: TVariables;
}): [{ data?: TData }];

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
