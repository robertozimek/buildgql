/** Flattens intersections so hovers and errors show one object, not `A & B & C`. */
export type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never;

/** Strips `null` from a union. Distributes, so `NonNull<A | null>` is `A`. */
export type NonNull<T> = T extends null ? never : T;
