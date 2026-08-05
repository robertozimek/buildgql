import type { Simplify, UnionToIntersection, NonNull } from '../../src/types/util.js';

type Expect<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type _1 = Expect<Eq<Simplify<{ a: 1 } & { b: 2 }>, { a: 1; b: 2 }>>;
type _2 = Expect<Eq<UnionToIntersection<{ a: 1 } | { b: 2 }>, { a: 1 } & { b: 2 }>>;
type _3 = Expect<Eq<NonNull<string | null>, string>>;

// 4. the `never`-union edge case must not leak `unknown` (regression guard)
type _4 = Expect<Eq<UnionToIntersection<never>, {}>>;
