import { describe, expect, it } from 'vitest';
import { resolveScalars } from '../../src/codegen/scalars.js';

describe('resolveScalars', () => {
  it('keeps the five built-ins when nothing is overridden', () => {
    const { scalars, prelude } = resolveScalars();
    expect(scalars.ID).toEqual({ input: 'string', output: 'string' });
    expect(scalars.Boolean).toEqual({ input: 'boolean', output: 'boolean' });
    expect(prelude).toEqual({ imports: [], declarations: [] });
  });

  it('treats a plain string as the same type in both positions', () => {
    const { scalars } = resolveScalars({ DateTime: 'string' });
    expect(scalars.DateTime).toEqual({ input: 'string', output: 'string' });
  });

  it('splits input and output when both are given', () => {
    const { scalars } = resolveScalars({ DateTime: { input: 'string | Date', output: 'string' } });
    expect(scalars.DateTime).toEqual({ input: 'string | Date', output: 'string' });
  });

  it('fills the missing half from the one that was given', () => {
    expect(resolveScalars({ A: { output: 'Date' } }).scalars.A).toEqual({ input: 'Date', output: 'Date' });
    expect(resolveScalars({ B: { input: 'Date' } }).scalars.B).toEqual({ input: 'Date', output: 'Date' });
  });

  it('records an import and uses its name in both positions', () => {
    const { scalars, prelude } = resolveScalars({ Money: { name: 'Money', from: '../types/money' } });
    expect(scalars.Money).toEqual({ input: 'Money', output: 'Money' });
    expect(prelude.imports).toEqual([{ name: 'Money', from: '../types/money' }]);
    expect(prelude.declarations).toEqual([]);
  });

  it('lets input/output override the imported name without dropping the import', () => {
    const { scalars, prelude } = resolveScalars({
      Money: { name: 'Money', from: '@myorg/types', input: 'Money | string' },
    });
    expect(scalars.Money).toEqual({ input: 'Money | string', output: 'Money' });
    expect(prelude.imports).toEqual([{ name: 'Money', from: '@myorg/types' }]);
  });

  it('records a declaration and uses its name in both positions', () => {
    const body = 'string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue }';
    const { scalars, prelude } = resolveScalars({ JSON: { name: 'JSONValue', declare: body } });
    expect(scalars.JSON).toEqual({ input: 'JSONValue', output: 'JSONValue' });
    expect(prelude.declarations).toEqual([{ name: 'JSONValue', body }]);
    expect(prelude.imports).toEqual([]);
  });

  it('applies the specifier rewriter to every "from"', () => {
    const { prelude } = resolveScalars(
      { A: { name: 'A', from: './a' }, B: { name: 'B', from: 'pkg' } },
      (from) => `<${from}>`,
    );
    expect(prelude.imports).toEqual([
      { name: 'A', from: '<./a>' },
      { name: 'B', from: '<pkg>' },
    ]);
  });

  it('emits one import when two scalars share the same name and source', () => {
    const { prelude } = resolveScalars({
      Metadata: { name: 'JsonValue', from: 'type-fest' },
      Payload: { name: 'JsonValue', from: 'type-fest' },
    });
    expect(prelude.imports).toEqual([{ name: 'JsonValue', from: 'type-fest' }]);
  });

  it('throws when two scalars claim the same name from different sources', () => {
    expect(() =>
      resolveScalars({
        A: { name: 'Shared', from: 'pkg-a' },
        B: { name: 'Shared', from: 'pkg-b' },
      }),
    ).toThrow(/buildgql: two scalars both map to a TypeScript type named "Shared"/);
  });

  it('orders the prelude by GraphQL scalar name, so the same config always emits the same bytes', () => {
    const { prelude } = resolveScalars({
      Zebra: { name: 'Zebra', from: 'z' },
      Apple: { name: 'Apple', from: 'a' },
    });
    expect(prelude.imports.map((i) => i.name)).toEqual(['Apple', 'Zebra']);
  });
});
