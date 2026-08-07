import { leafField, objectField } from '../../src/runtime/builders.js';
import { on } from '../../src/runtime/on.js';
import { makeQuery } from '../../src/runtime/operation.js';
import type { RESULT } from '../../src/types/symbols.js';

type Expect<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const Dog = {
  name: leafField<'name', ['!'], string>('name', ['!']),
  breed: leafField<'breed', ['!'], string>('breed', ['!']),
};
const Cat = {
  name: leafField<'name', ['!'], string>('name', ['!']),
  lives: leafField<'lives', ['!'], number>('lives', ['!']),
};
// A union's own field map exposes only the interface/common fields.
const Pet = { name: leafField<'name', ['!'], string>('name', ['!']) };
const Query = { pet: objectField('pet', ['!'], Pet) };
const query = makeQuery(Query);

const q = query('Pet', ($, Q) => [
  Q.pet((P) => [P.name, on('Dog', Dog, (D) => [D.breed]), on('Cat', Cat, (C) => [C.lives])]),
]);
type PetR = NonNullable<(typeof q)[typeof RESULT]>['pet'];

// common fields are distributed across every branch
type _1 = Expect<
  Eq<
    PetR,
    { name: string; breed: string; __typename: 'Dog' } | { name: string; lives: number; __typename: 'Cat' }
  >
>;

// and it narrows on __typename
function narrows(p: PetR): string | number {
  return p.__typename === 'Dog' ? p.breed : p.lives;
}

export { q, narrows };
