import { args, leaf, object, objectArgs } from '../../src/runtime/builders.js';
import { makeMutation, makeQuery } from '../../src/runtime/operation.js';
import { createClient } from '../../src/client/client.js';

const User = {
  id: leaf<'id', ['!'], string>('id', ['!']),
  firstName: leaf<'firstName', ['!'], string>('firstName', ['!']),
  lastName: leaf<'lastName', [], string>('lastName', []),
};
const query = makeQuery({ users: object('users', ['!', 'l', '!'], User) });
const mutation = makeMutation({
  createUser: objectArgs(
    'createUser',
    ['!'],
    User,
    args<{ name: string; email: string }>({ name: 'String!', email: 'String!' }),
  ),
});
const client = createClient({ url: 'http://localhost/graphql' });

const m = mutation('CreateNewUser', ($, M) => [M.createUser({ name: $.name, email: $.email }, (U) => [U.id])]);
const q = query('Users', ($, Q) => [Q.users((U) => [U.id, U.lastName])]);

async function main() {
  const r = await client.execute(m, { name: 'John Smith', email: 'john@smith.com' });
  const id: string = r.createUser.id;

  // an operation with no variables needs no second argument
  const r2 = await client.execute(q);
  const bio: string | null = r2.users[0]!.lastName;

  // @ts-expect-error missing required variable
  await client.execute(m, { name: 'x' });
  // @ts-expect-error wrong variable type
  await client.execute(m, { name: 1, email: 'x' });
  // @ts-expect-error unknown variable
  await client.execute(m, { name: 'a', email: 'b', extra: 1 });
  // @ts-expect-error field was not selected
  r.createUser.firstName;

  // Pre-declared vars: without NoInfer, `V` would be inferred from this argument
  // and the missing `email` would be silently accepted. This is the only case in
  // this file that actually guards NoInfer — the inline-literal cases above are
  // caught by excess-property checking regardless.
  const preDeclared = { name: 'x' };
  // @ts-expect-error missing required variable
  await client.execute(m, preDeclared);

  return { id, bio };
}

export { main };
