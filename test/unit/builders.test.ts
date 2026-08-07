import { describe, expect, it } from 'vitest';
import { argSpec, leafField, objectField, objectFieldArgs } from '../../src/runtime/builders.js';
import { $, v } from '../../src/runtime/var.js';

const User = { id: leafField<'id', ['!'], string>('id', ['!']) };

describe('leafField', () => {
  it('produces a field node', () => {
    expect(leafField('id', ['!'])).toMatchObject({ kind: 'field', name: 'id' });
  });

  it('records an alias', () => {
    expect(leafField('id', ['!']).as('postId')).toMatchObject({
      kind: 'field',
      name: 'id',
      alias: 'postId',
    });
  });
});

describe('objectField', () => {
  it('nests the picked selections', () => {
    const node = objectField('author', ['!'], User)((U) => [U.id]);
    expect(node.name).toBe('author');
    expect(node.sels?.map((s) => (s as { name: string }).name)).toEqual(['id']);
  });
});

describe('objectFieldArgs', () => {
  const createUser = objectFieldArgs(
    'createUser',
    ['!'],
    User,
    argSpec<{ name: string; email: string }>({ name: 'String!', email: 'String!' }),
  );

  it('keeps literal arguments as values', () => {
    const node = createUser({ name: 'John', email: 'j@s.com' }, (U) => [U.id]);
    expect(node.args).toEqual({ name: 'John', email: 'j@s.com' });
    expect(node.varRefs).toEqual([]);
  });

  it('records a variable reference named after the argument key', () => {
    const node = createUser({ name: $.name, email: 'j@s.com' }, (U) => [U.id]);
    expect(node.varRefs).toEqual([{ varName: 'name', gqlType: 'String!' }]);
  });

  it('honours an explicit variable name', () => {
    const node = createUser({ name: v('userName'), email: 'e' }, (U) => [U.id]);
    expect(node.varRefs).toEqual([{ varName: 'userName', gqlType: 'String!' }]);
  });
});
