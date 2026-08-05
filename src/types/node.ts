import type { KEY, RESULT, VARS } from './symbols.js';

/** A variable reference recorded at build time, used to emit `$name: Type!`. */
export interface VarRef {
  readonly varName: string;
  readonly gqlType: string;
}

export interface DirectiveNode {
  readonly name: 'include' | 'skip';
  /** Either a literal boolean or a variable reference. */
  readonly if: boolean | VarRef;
}

/**
 * A selected field.
 * `N` is the key it lands under in the result. It is carried by the phantom
 * `[KEY]` property — it MUST appear structurally, or `Extract`/`Exclude` cannot
 * tell two `Sel`s apart and the whole remap collapses.
 * `O` marks the field optional in the result (set by `@include`/`@skip`).
 */
export interface Sel<N extends string, R, V = {}, O extends boolean = false> {
  readonly kind: 'field';
  readonly name: string;
  readonly alias?: string;
  readonly args?: Record<string, unknown>;
  readonly sels?: readonly Node[];
  readonly directives?: readonly DirectiveNode[];
  readonly varRefs?: readonly VarRef[];
  readonly [KEY]?: N;
  readonly [RESULT]?: R;
  readonly [VARS]?: V;
  readonly __optional?: O;
}

/** A fragment spread. Required `kind` discriminant makes Extract/Exclude work. */
export interface Spread<R, V = {}> {
  readonly kind: 'spread';
  readonly fragmentName: string;
  readonly [RESULT]?: R;
  readonly [VARS]?: V;
}

/** An inline fragment (`... on Dog { ... }`). */
export interface On<TN extends string, R, V = {}> {
  readonly kind: 'on';
  readonly typename: string;
  readonly sels: readonly Node[];
  readonly [KEY]?: TN;
  readonly [RESULT]?: R;
  readonly [VARS]?: V;
}

export type AnySel = Sel<string, any, any, boolean>;
export type Node = AnySel | Spread<any, any> | On<string, any, any>;
