import { expect, it } from 'vitest';
import { leaf, object } from '../../src/runtime/builders.js';
import { on } from '../../src/runtime/on.js';
import { makeQuery } from '../../src/runtime/operation.js';

const Dog = { breed: leaf<'breed', ['!'], string>('breed', ['!']) };
const Cat = { lives: leaf<'lives', ['!'], number>('lives', ['!']) };
const Pet = { name: leaf<'name', ['!'], string>('name', ['!']) };
const query = makeQuery({ pet: object('pet', ['!'], Pet) });

it('prints inline fragments and auto-selects __typename', () => {
  const q = query('Pet', ($, Q) => [
    Q.pet((P) => [P.name, on('Dog', Dog, (D) => [D.breed]), on('Cat', Cat, (C) => [C.lives])]),
  ]);
  expect(q.document).toBe('query Pet { pet { __typename name ... on Dog { breed } ... on Cat { lives } } }');
});

it('does not add __typename when there are no inline fragments', () => {
  const q = query('Pet', ($, Q) => [Q.pet((P) => [P.name])]);
  expect(q.document).toBe('query Pet { pet { name } }');
});
