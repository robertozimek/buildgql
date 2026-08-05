import type { Sel, Spread, On, Node } from '../../src/types/node.js';
import type { Selected, VarsIn } from '../../src/types/select.js';

type Expect<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Id = Sel<'id', string>;
type Title = Sel<'title', string>;
type Bio = Sel<'bio', string, {}, true>; // optional (a @include'd field)

// 1. plain fields remap to an object keyed by the selection key
type _1 = Expect<Eq<Selected<[Id, Title]>, { id: string; title: string }>>;

// 2. an optional selection produces an optional property
type _2 = Expect<Eq<Selected<[Id, Bio]>, { id: string; bio?: string }>>;

// 3. a fragment spread merges into the parent rather than nesting
type _3 = Expect<Eq<Selected<[Id, Spread<{ a: number; b: number }>]>, { id: string; a: number; b: number }>>;

// 4. inline fragments produce a discriminated union of the common fields
type Dog = On<'Dog', { __typename: 'Dog'; breed: string }>;
type Cat = On<'Cat', { __typename: 'Cat'; lives: number }>;
type _4 = Expect<
  Eq<
    Selected<[Id, Dog, Cat]>,
    { id: string; __typename: 'Dog'; breed: string } | { id: string; __typename: 'Cat'; lives: number }
  >
>;

// 5. empty selection is an empty object
type _5 = Expect<Eq<Selected<[]>, {}>>;

// VarsIn tests
// 6. single Sel contributing one variable map
type _6 = Expect<Eq<VarsIn<[Sel<'id', string, { varA: string }>]>, { varA: string }>>;

// 7. two Sels contributing different variable maps — result is their intersection
type _7 = Expect<
  Eq<
    VarsIn<[Sel<'id', string, { varA: string }>, Sel<'title', string, { varB: number }>]>,
    { varA: string } & { varB: number }
  >
>;

// 8. Sel with no variables does not pollute the result
type _8 = Expect<
  Eq<
    VarsIn<[Sel<'id', string, {}>, Sel<'title', string, { varA: string }>]>,
    {} & { varA: string }
  >
>;

// 9. Spread and On both contribute variables
type _9 = Expect<
  Eq<
    VarsIn<[Spread<{ a: number }, { varX: boolean }>, On<'Type', { b: string }, { varY: string }>]>,
    { varX: boolean } & { varY: string }
  >
>;

// 10. empty tuple case - no variables to collect, so result is unknown
type _10 = Expect<Eq<VarsIn<[]>, unknown>>;

declare const n: Node;
export type { n };
