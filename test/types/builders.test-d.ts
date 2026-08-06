import { leafField, objectField, objectFieldArgs, argSpec } from '../../src/runtime/builders.js';
import { $, v } from '../../src/runtime/var.js';
import type { Selected, VarsIn } from '../../src/types/select.js';
import type { SelectionNode } from '../../src/types/selection.js';
import type { RESULT, VARS } from '../../src/types/symbols.js';
import type { Simplify } from '../../src/types/util.js';

type Expect<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const User = {
  id: leafField<'id', ['!'], string>('id', ['!']),
  firstName: leafField<'firstName', ['!'], string>('firstName', ['!']),
  lastName: leafField<'lastName', [], string>('lastName', []),
};
const Post = {
  id: leafField<'id', ['!'], string>('id', ['!']),
  title: leafField<'title', ['!'], string>('title', ['!']),
  author: objectField('author', ['!'], User),
};
const Root = {
  posts: objectField('posts', ['!', 'l', '!'], Post),
  createUser: objectFieldArgs(
    'createUser',
    ['!'],
    User,
    argSpec<{ name: string; email: string; age?: number }>({
      name: 'String!',
      email: 'String!',
      age: 'Int',
    }),
  ),
};

declare function build<S extends readonly SelectionNode[]>(
  pick: (r: typeof Root) => readonly [...S],
): { r: Selected<S>; v: Simplify<VarsIn<S>> };

// 1. wrappers survive: [Post!]! is Post[], nullable leaf is string | null
const a = build((R) => [R.posts((P) => [P.id, P.title, P.author((A) => [A.id, A.lastName])])]);
type _1 = Expect<
  Eq<
    (typeof a)['r'],
    { posts: { id: string; title: string; author: { id: string; lastName: string | null } }[] }
  >
>;

// 2. variables are captured from argument position and named after the arg key
const b = build((R) => [R.createUser({ name: $.name, email: $.email }, (U) => [U.id])]);
type _2 = Expect<Eq<(typeof b)['v'], { name: string; email: string }>>;

// 3. optional arg -> optional variable; literals contribute nothing
const c = build((R) => [R.createUser({ name: 'J', email: 'e', age: $.age }, (U) => [U.id])]);
type _3 = Expect<Eq<(typeof c)['v'], { age?: number }>>;

// 4. explicit variable naming
const d = build((R) => [R.createUser({ name: v('userName'), email: 'e' }, (U) => [U.id])]);
type _4 = Expect<Eq<(typeof d)['v'], { userName: string }>>;

// 5. aliases rename the result key
const e = build((R) => [R.posts((P) => [P.id.as('postId'), P.title])]);
type _5 = Expect<Eq<(typeof e)['r'], { posts: { postId: string; title: string }[] }>>;

// 6. aliasing an object field
const f = build((R) => [R.posts.as('articles')((P) => [P.id])]);
type _6 = Expect<Eq<(typeof f)['r'], { articles: { id: string }[] }>>;

// 7. wrong argument types are rejected
// @ts-expect-error name must be a string or a variable
build((R) => [R.createUser({ name: 42, email: 'e' }, (U) => [U.id])]);

// 8. unknown fields are rejected
// @ts-expect-error `nope` is not a field of Post
build((R) => [R.posts((P) => [P.nope])]);

export { a, b, c, d, e, f };
