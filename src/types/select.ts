import type { AnySel, Node, On, Sel, Spread } from './node.js';
import type { KEY, RESULT, VARS } from './symbols.js';
import type { Simplify, UnionToIntersection } from './util.js';

type KeyOf<E> = E extends Sel<infer N, any, any, any> ? N : never;
type ResOf<E> = E extends Sel<any, infer R, any, any> ? R : never;

type RequiredSels<S extends readonly Node[]> = Extract<S[number], Sel<string, any, any, false>>;
type OptionalSels<S extends readonly Node[]> = Extract<S[number], Sel<string, any, any, true>>;

type PlainFields<S extends readonly Node[]> = { [E in RequiredSels<S> as KeyOf<E>]: ResOf<E> } & {
  [E in OptionalSels<S> as KeyOf<E>]?: ResOf<E>;
};

/**
 * Fragment spreads merge into the parent object.
 * Written in the distributive `S[number] extends infer E` form on purpose:
 * `Extract<S[number], Spread<any, any>> extends Spread<infer R, any>` is NOT a
 * naked type parameter, so it collapses the union instead of mapping over it.
 */
type SpreadFields<S extends readonly Node[]> = UnionToIntersection<
  S[number] extends infer E ? (E extends Spread<infer R, any> ? R : {}) : never
>;

/** The union of inline-fragment branches, or `never` when there are none. */
type OnBranches<S extends readonly Node[]> = S[number] extends infer E
  ? E extends On<any, infer R, any>
    ? R
    : never
  : never;

/**
 * Assemble a selection tuple into its result type.
 * With no inline fragments this is just the field map. With inline fragments the
 * common fields are distributed across every branch, producing a discriminated
 * union that narrows on `__typename`.
 */
export type Selected<S extends readonly Node[]> = [OnBranches<S>] extends [never]
  ? Simplify<PlainFields<S> & SpreadFields<S>>
  : Simplify<PlainFields<S> & SpreadFields<S>> extends infer Common
    ? OnBranches<S> extends infer B
      ? B extends any
        ? Simplify<Common & B>
        : never
      : never
    : never;

/** Union of every variable map contributed anywhere in a selection tuple. */
export type VarsIn<S extends readonly Node[]> = UnionToIntersection<
  {
    [I in keyof S]: S[I] extends { readonly [VARS]?: infer V } ? (V extends undefined ? {} : V) : {};
  }[number]
>;

export type { KeyOf, PlainFields, SpreadFields, OnBranches };
export type { AnySel, Node, On, Sel, Spread, KEY, RESULT, VARS };
