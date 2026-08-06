import type { FieldSelection, FragmentSpread, InlineFragment, SelectionNode } from './selection.js';
import type { VARS } from './symbols.js';
import type { Simplify, UnionToIntersection } from './util.js';

type KeyOf<E> = E extends FieldSelection<infer N, unknown, unknown, boolean> ? N : never;
type ResOf<E> = E extends FieldSelection<string, infer R, unknown, boolean> ? R : never;

type RequiredSels<S extends readonly SelectionNode[]> = Extract<
  S[number],
  FieldSelection<string, unknown, unknown, false>
>;
type OptionalSels<S extends readonly SelectionNode[]> = Extract<
  S[number],
  FieldSelection<string, unknown, unknown, true>
>;

type PlainFields<S extends readonly SelectionNode[]> = { [E in RequiredSels<S> as KeyOf<E>]: ResOf<E> } & {
  [E in OptionalSels<S> as KeyOf<E>]?: ResOf<E>;
};

/**
 * Fragment spreads merge into the parent object.
 * Written in the distributive `S[number] extends infer E` form on purpose:
 * `Extract<S[number], FragmentSpread<unknown, unknown>> extends FragmentSpread<infer R, unknown>` is NOT a
 * naked type parameter, so it collapses the union instead of mapping over it.
 */
type SpreadFields<S extends readonly SelectionNode[]> = UnionToIntersection<
  S[number] extends infer E ? (E extends FragmentSpread<infer R, unknown> ? R : {}) : never
>;

/** The union of inline-fragment branches, or `never` when there are none. */
type OnBranches<S extends readonly SelectionNode[]> = S[number] extends infer E
  ? E extends InlineFragment<string, infer R, unknown>
    ? R
    : never
  : never;

/**
 * Assemble a selection tuple into its result type.
 * With no inline fragments this is just the field map. With inline fragments the
 * common fields are distributed across every branch, producing a discriminated
 * union that narrows on `__typename`.
 */
export type Selected<S extends readonly SelectionNode[]> = [OnBranches<S>] extends [never]
  ? Simplify<PlainFields<S> & SpreadFields<S>>
  : Simplify<PlainFields<S> & SpreadFields<S>> extends infer Common
    ? OnBranches<S> extends infer B
      ? B extends unknown
        ? Simplify<Common & B>
        : never
      : never
    : never;

/**
 * Union of every variable map contributed anywhere in a selection tuple.
 */
export type VarsIn<S extends readonly SelectionNode[]> = UnionToIntersection<
  {
    [I in keyof S]: S[I] extends { readonly [VARS]?: infer V } ? (V extends undefined ? {} : V) : {};
  }[number]
>;
