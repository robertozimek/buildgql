import type {
  FieldSelection,
  FragmentSpread,
  InlineFragment,
  SelectionNode,
} from '../../src/types/selection.js';
import type { Selected, VarsIn } from '../../src/types/select.js';

type Expect<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Id = FieldSelection<'id', string>;
type Title = FieldSelection<'title', string>;
type Bio = FieldSelection<'bio', string, {}, true>; // optional (a @include'd field)

// 1. plain fields remap to an object keyed by the selection key
type _1 = Expect<Eq<Selected<[Id, Title]>, { id: string; title: string }>>;

// 2. an optional selection produces an optional property
type _2 = Expect<Eq<Selected<[Id, Bio]>, { id: string; bio?: string }>>;

// 3. a fragment spread merges into the parent rather than nesting
type _3 = Expect<
  Eq<Selected<[Id, FragmentSpread<{ a: number; b: number }>]>, { id: string; a: number; b: number }>
>;

// 4. inline fragments produce a discriminated union of the common fields
type Dog = InlineFragment<'Dog', { __typename: 'Dog'; breed: string }>;
type Cat = InlineFragment<'Cat', { __typename: 'Cat'; lives: number }>;
type _4 = Expect<
  Eq<
    Selected<[Id, Dog, Cat]>,
    { id: string; __typename: 'Dog'; breed: string } | { id: string; __typename: 'Cat'; lives: number }
  >
>;

// 5. empty selection is an empty object
type _5 = Expect<Eq<Selected<[]>, {}>>;

// VarsIn tests
// 6. single FieldSelection contributing one variable map
type _6 = Expect<Eq<VarsIn<[FieldSelection<'id', string, { varA: string }>]>, { varA: string }>>;

// 7. two FieldSelections contributing different variable maps — result is their intersection
type _7 = Expect<
  Eq<
    VarsIn<
      [FieldSelection<'id', string, { varA: string }>, FieldSelection<'title', string, { varB: number }>]
    >,
    { varA: string } & { varB: number }
  >
>;

// 8. FieldSelection with no variables does not pollute the result
type _8 = Expect<
  Eq<
    VarsIn<[FieldSelection<'id', string, {}>, FieldSelection<'title', string, { varA: string }>]>,
    {} & { varA: string }
  >
>;

// 9. FragmentSpread and InlineFragment both contribute variables
type _9 = Expect<
  Eq<
    VarsIn<
      [
        FragmentSpread<{ a: number }, { varX: boolean }>,
        InlineFragment<'Type', { b: string }, { varY: string }>,
      ]
    >,
    { varX: boolean } & { varY: string }
  >
>;

// 10. empty tuple case - no variables to collect, so result is {}
type _10 = Expect<Eq<VarsIn<[]>, {}>>;

declare const n: SelectionNode;
export type { n };
