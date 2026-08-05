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
