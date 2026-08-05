import { describe, expect, it } from 'vitest';
import { args, leaf, object, objectArgs } from '../../src/runtime/builders.js';
import { $, v } from '../../src/runtime/var.js';

const User = { id: leaf<'id', ['!'], string>('id', ['!']) };

describe('leaf', () => {
  it('produces a field node', () => {
    expect(leaf('id', ['!'])).toMatchObject({ kind: 'field', name: 'id' });
  });

  it('records an alias', () => {
    expect(leaf('id', ['!']).as('postId')).toMatchObject({ kind: 'field', name: 'id', alias: 'postId' });
  });
});

describe('object', () => {
  it('nests the picked selections', () => {
    const node = object('author', ['!'], User)((U) => [U.id]);
    expect(node.name).toBe('author');
    expect(node.sels?.map((s) => (s as { name: string }).name)).toEqual(['id']);
  });
});

describe('objectArgs', () => {
  const createUser = objectArgs(
    'createUser',
    ['!'],
    User,
    args<{ name: string; email: string }>({ name: 'String!', email: 'String!' }),
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
