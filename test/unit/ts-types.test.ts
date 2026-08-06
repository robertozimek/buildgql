import { expect, it } from 'vitest';
import { inputTsType } from '../../src/codegen/ts-types.js';
import type { IRSchema, IRTypeRef } from '../../src/codegen/ir.js';

/** A minimal IRSchema carrying only the scalar map `inputTsType` reads. */
function schemaWithScalars(scalars: Record<string, string>): IRSchema {
  return {
    queryType: 'Query',
    mutationType: null,
    subscriptionType: null,
    types: [],
    scalars: {
      ID: 'string',
      String: 'string',
      Int: 'number',
      Float: 'number',
      Boolean: 'boolean',
      ...scalars,
    },
  };
}

/** `[JSON!]` — a nullable list of non-null JSON. `flatten` records it outer-to-inner. */
const listOfNonNull: IRTypeRef = { wrap: ['l', '!'], name: 'JSON', kind: 'scalar' };

it('parenthesises a union-typed scalar inside a list', () => {
  const ir = schemaWithScalars({ JSON: 'string | number' });
  // Without parens this is `string | number[] | null`, which TypeScript reads as
  // `string | (number[]) | null` — it accepts a bare string and rejects ['a', 1].
  expect(inputTsType(listOfNonNull, ir)).toBe('(string | number)[] | null');
});

it('parenthesises a function-typed scalar inside a list', () => {
  const ir = schemaWithScalars({ JSON: '(a: string) => void' });
  expect(inputTsType(listOfNonNull, ir)).toBe('((a: string) => void)[] | null');
});

it('leaves an identifier, a generic and an object literal unparenthesised', () => {
  // Pins the common case against cosmetic churn: these already bind tighter than `[]`.
  expect(inputTsType(listOfNonNull, schemaWithScalars({ JSON: 'string' }))).toBe('string[] | null');
  expect(inputTsType(listOfNonNull, schemaWithScalars({ JSON: 'Record<string, unknown>' }))).toBe(
    'Record<string, unknown>[] | null',
  );
  expect(inputTsType(listOfNonNull, schemaWithScalars({ JSON: '{ x: number; y: number }' }))).toBe(
    '{ x: number; y: number }[] | null',
  );
});

it('still nests lists correctly once the base is parenthesised', () => {
  const ir = schemaWithScalars({ JSON: 'string | number' });
  // `[[JSON!]!]` — a nullable list of non-null lists of non-null JSON.
  const nested: IRTypeRef = { wrap: ['l', '!', 'l', '!'], name: 'JSON', kind: 'scalar' };
  expect(inputTsType(nested, ir)).toBe('(string | number)[][] | null');
});
