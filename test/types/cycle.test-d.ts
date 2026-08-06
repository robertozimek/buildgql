import { leafField, objectField } from '../../src/runtime/builders.js';
import { makeQuery } from '../../src/runtime/operation.js';
import type { RESULT } from '../../src/types/symbols.js';

type Expect<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const Post = {
  id: leafField<'id', ['!'], string>('id', ['!']),
  get author() {
    return objectField('author', ['!'], User);
  },
};
const User = {
  id: leafField<'id', ['!'], string>('id', ['!']),
  get posts() {
    return objectField('posts', ['!', 'l', '!'], Post);
  },
};

const query = makeQuery({ posts: objectField('posts', ['!', 'l', '!'], Post) });

// two levels through the cycle: Post -> User -> Post
const q = query('Q', ($, Q) => [Q.posts((P) => [P.id, P.author((A) => [A.id, A.posts((P2) => [P2.id])])])]);
type _1 = Expect<
  Eq<
    NonNullable<(typeof q)[typeof RESULT]>,
    { posts: { id: string; author: { id: string; posts: { id: string }[] } }[] }
  >
>;

export { q };
