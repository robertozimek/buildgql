import type { Apply } from '../../src/types/wrap.js';

type Expect<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Post = { id: string };

type _1 = Expect<Eq<Apply<[], Post>, Post | null>>;
type _2 = Expect<Eq<Apply<['!'], Post>, Post>>;
type _3 = Expect<Eq<Apply<['!', 'l', '!'], Post>, Post[]>>;
type _4 = Expect<Eq<Apply<['l', '!'], Post>, Post[] | null>>;
type _5 = Expect<Eq<Apply<['!', 'l'], Post>, (Post | null)[]>>;
type _6 = Expect<Eq<Apply<['l', 'l'], number>, ((number | null)[] | null)[] | null>>;
type _7 = Expect<Eq<Apply<['!', 'l', '!', 'l', '!'], number>, number[][]>>;
