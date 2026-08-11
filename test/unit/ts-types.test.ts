import { expect, it } from 'vitest';
import { inputTsType, leafTsType } from '../../src/codegen/ts-types.js';
import { resolveScalars } from '../../src/codegen/scalars.js';
import type { IRSchema, IRTypeRef } from '../../src/codegen/ir.js';
import type { ScalarConfig } from '../../src/codegen/scalars.js';

/** A minimal IRSchema carrying only the scalar map `inputTsType`/`leafTsType` read. */
function schemaWithScalars(scalars: Record<string, ScalarConfig>): IRSchema {
  const resolved = resolveScalars(scalars);
  return {
    queryType: 'Query',
    mutationType: null,
    subscriptionType: null,
    types: [],
    scalars: resolved.scalars,
    scalarPrelude: resolved.prelude,
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

// A regex-based `.*` inside `{...}` / `<...>` spans from the first bracket to the LAST one in
// the whole string, so a multi-operand union or intersection whose final operand happens to
// end in `}` or `>` reads, to that regex, as one big object-literal-or-generic — and gets
// wrongly classified atomic. These pin the fix: a top-level `|`/`&` must be found regardless
// of what brackets appear elsewhere in the string.
it('parenthesises a union of two generic instantiations, not just a bare union', () => {
  const ir = schemaWithScalars({ JSON: 'Record<string, unknown> | Array<unknown>' });
  expect(inputTsType(listOfNonNull, ir)).toBe('(Record<string, unknown> | Array<unknown>)[] | null');
});

it('parenthesises a union of two object literals, not just a bare union', () => {
  const ir = schemaWithScalars({ JSON: '{ a: string } | { b: number }' });
  expect(inputTsType(listOfNonNull, ir)).toBe('({ a: string } | { b: number })[] | null');
});

it('parenthesises an intersection of two object literals', () => {
  const ir = schemaWithScalars({ JSON: '{ a: string } & { b: number }' });
  expect(inputTsType(listOfNonNull, ir)).toBe('({ a: string } & { b: number })[] | null');
});

it('parenthesises a union of two other generic instantiations', () => {
  const ir = schemaWithScalars({ JSON: 'Array<string> | Set<number>' });
  expect(inputTsType(listOfNonNull, ir)).toBe('(Array<string> | Set<number>)[] | null');
});

it("leaves a union nested entirely inside one generic's type argument unparenthesised", () => {
  // The `|` here is at bracket depth 1 (inside `Array<...>`), not top-level, so `Array<string
  // | number>` is itself a single atomic generic instantiation — unlike the cases above.
  const ir = schemaWithScalars({ JSON: 'Array<string | number>' });
  expect(inputTsType(listOfNonNull, ir)).toBe('Array<string | number>[] | null');
});

// The depth scan above treats `)`, `]`, `}` and `>` as closers. But `=>`'s `>` was never
// opened by this scan (arrow functions don't open with `<`) — counting it anyway decrements
// depth for a bracket that doesn't exist, so depth reaches 0 one bracket too early and a real
// top-level `|`/`&` after a function type goes undetected. These pin that a function type
// nested inside the union — parenthesised, inside a generic, or bare — doesn't swallow the
// operator that follows it.
it('parenthesises a union whose first operand is a parenthesised function type', () => {
  const ir = schemaWithScalars({ JSON: '((x: string) => number) | string' });
  expect(inputTsType(listOfNonNull, ir)).toBe('(((x: string) => number) | string)[] | null');
});

it('parenthesises a union whose first operand is a generic containing a function type', () => {
  const ir = schemaWithScalars({ JSON: 'Record<string, () => void> | string' });
  expect(inputTsType(listOfNonNull, ir)).toBe('(Record<string, () => void> | string)[] | null');
});

it('parenthesises a union whose first operand is Array<() => void>', () => {
  const ir = schemaWithScalars({ JSON: 'Array<() => void> | number' });
  expect(inputTsType(listOfNonNull, ir)).toBe('(Array<() => void> | number)[] | null');
});

const nonNullRef: IRTypeRef = { wrap: ['!'], name: 'JSON', kind: 'scalar' };

it('reads the output type in result position and the input type in argument position', () => {
  const ir = schemaWithScalars({ JSON: { input: 'string | Date', output: 'string' } });
  expect(leafTsType(nonNullRef, ir)).toBe('string');
  // The atomicity guard wraps any non-atomic base unconditionally, pre-existing
  // behaviour that predates this feature — `leafTsType` above is unguarded because
  // its result is spliced into a type-argument list where `|` binds tighter than the
  // `,` separating arguments; `inputTsType` has no such guarantee at its call sites.
  expect(inputTsType(nonNullRef, ir)).toBe('(string | Date)');
});

it('still parenthesises a split input type inside a list', () => {
  // The atomicity guard applies to whichever expression the *input* side resolved to,
  // not to whatever the output side happens to be.
  const ir = schemaWithScalars({ JSON: { input: 'string | Date', output: 'string' } });
  expect(inputTsType(listOfNonNull, ir)).toBe('(string | Date)[] | null');
});

it('uses an imported name in both positions', () => {
  const ir = schemaWithScalars({ JSON: { name: 'Money', from: './money' } });
  expect(leafTsType(nonNullRef, ir)).toBe('Money');
  expect(inputTsType(nonNullRef, ir)).toBe('Money');
});

it('falls back to unknown in both positions for a scalar with no entry', () => {
  const ir = schemaWithScalars({});
  expect(leafTsType(nonNullRef, ir)).toBe('unknown');
  expect(inputTsType(nonNullRef, ir)).toBe('unknown');
});
