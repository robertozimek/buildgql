import type { KEY, RESULT, VARS } from './symbols.js';

/** A variable reference recorded at build time, used to emit `$name: Type!`. */
export interface VarRef {
  readonly varName: string;
  readonly gqlType: string;
}

/** An `@include`/`@skip` directive attached to a field selection. */
export interface Directive {
  readonly name: 'include' | 'skip';
  /** Either a literal boolean or a variable reference. */
  readonly if: boolean | VarRef;
}

/**
 * A selected field.
 * `N` is the key it lands under in the result. It is carried by the phantom
 * `[KEY]` property — it MUST appear structurally, or `Extract`/`Exclude` cannot
 * tell two selections apart and the whole remap collapses.
 * `O` marks the field optional in the result (set by `@include`/`@skip`).
 */
export interface FieldSelection<N extends string, R, V = {}, O extends boolean = false> {
  readonly kind: 'field';
  readonly name: string;
  readonly alias?: string;
  readonly args?: Record<string, unknown>;
  readonly sels?: readonly SelectionNode[];
  readonly directives?: readonly Directive[];
  readonly varRefs?: readonly VarRef[];
  readonly [KEY]?: N;
  readonly [RESULT]?: R;
  readonly [VARS]?: V;
  readonly __optional?: O;
}

/**
 * The part of a fragment a spread needs to carry: enough to emit the definition
 * and to walk into it for variables. Declared here rather than in
 * `src/runtime/fragment.ts` so `print.ts` and `fragment.ts` share one contract
 * instead of each re-declaring the shape behind a cast.
 */
export interface FragmentDefinition {
  readonly name: string;
  readonly typeCondition: string;
  readonly sels: readonly SelectionNode[];
}

/** A fragment spread. Required `kind` discriminant makes Extract/Exclude work. */
export interface FragmentSpread<R, V = {}> {
  readonly kind: 'spread';
  /**
   * The fragment being spread. Consumed by `collectFragments` and the variable walk
   * in `print.ts`. Its `name` is the single source of truth for the fragment's printed
   * name — there is deliberately no separate `fragmentName` field to keep in sync.
   */
  readonly fragment: FragmentDefinition;
  readonly [RESULT]?: R;
  readonly [VARS]?: V;
}

/** An inline fragment (`... on Dog { ... }`). */
export interface InlineFragment<TN extends string, R, V = {}> {
  readonly kind: 'on';
  readonly typename: string;
  readonly sels: readonly SelectionNode[];
  readonly [KEY]?: TN;
  readonly [RESULT]?: R;
  readonly [VARS]?: V;
}

export type AnyFieldSelection = FieldSelection<string, unknown, unknown, boolean>;
export type SelectionNode =
  AnyFieldSelection | FragmentSpread<unknown, unknown> | InlineFragment<string, unknown, unknown>;
