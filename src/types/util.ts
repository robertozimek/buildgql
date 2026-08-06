/** Flattens intersections so hovers and errors show one object, not `A & B & C`. */
export type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Intersects a union. The `[U] extends [never]` guard is load-bearing: the bare
 * idiom maps `never` to `unknown`, which silently leaks into every derived type
 * built on it (`VarsIn<[]>`, `VarsOf<{}, Spec>`, `SpreadFields<[]>`) and violates
 * the "no derived type resolves to unknown" constraint. Empty union -> `{}`.
 */
export type UnionToIntersection<U> = [U] extends [never]
  ? {}
  : (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void
    ? I
    : never;

/** Strips `null` from a union. Distributes, so `NonNull<A | null>` is `A`. */
export type NonNull<T> = T extends null ? never : T;

/** Keys of `V` that are not optional. */
export type RequiredKeys<V> = { [K in keyof V]-?: {} extends Pick<V, K> ? never : K }[keyof V];
