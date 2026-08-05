import type { UnionToIntersection } from './util.js';

/**
 * A placeholder standing in for a GraphQL variable.
 * `N` is only populated by the explicit `v('name')` helper; the `$` proxy
 * produces `VarMarker<string>` because a mapped type over `string` cannot
 * preserve the accessed key.
 */
export interface VarMarker<N extends string = string> {
  readonly __var: N;
}

/** Any argument slot accepts a literal value or a variable placeholder. */
export type Arg<T> = T | VarMarker;
export type ArgsInput<Spec> = { [K in keyof Spec]: Arg<Spec[K]> };

/**
 * Carries a field's argument types at the type level and their GraphQL type
 * strings at runtime (needed to print `$name: String!`).
 */
export interface ArgSpec<T> {
  readonly gql: Readonly<Record<string, string>>;
  readonly __t?: T;
}

type IsOpt<Spec, K> = K extends keyof Spec ? ({} extends Pick<Spec, K> ? true : false) : false;

type VarEntry<N extends string, T, O extends boolean> = O extends true ? { [P in N]?: T } : { [P in N]: T };

/**
 * Derive the variable map from the args the user wrote.
 * Name comes from the arg key (or the explicit `v()` name); type comes from the
 * codegen-supplied `Spec`. Optional args yield optional variables.
 */
export type VarsOf<A, Spec> = UnionToIntersection<
  {
    [K in keyof A]: A[K] extends VarMarker<infer N>
      ? string extends N
        ? VarEntry<K & string, K extends keyof Spec ? Spec[K] : never, IsOpt<Spec, K>>
        : VarEntry<N, K extends keyof Spec ? Spec[K] : never, IsOpt<Spec, K>>
      : {};
  }[keyof A]
>;

/**
 * The `$` object handed to operation builders.
 * Deliberately NOT callable: a callable type would resolve `$.name`, `$.length`,
 * `$.call`, `$.apply` and `$.bind` to `Function`'s own members, silently turning
 * those variables into plain strings. Explicit naming lives in `v()` instead.
 */
export type VarProxy = { readonly [K in string]: VarMarker };

// `IsOpt` and `VarEntry` stay file-local: they are composition helpers for
// `VarsOf` with no consumer elsewhere, and exporting them would put untested
// types on the public API surface.
