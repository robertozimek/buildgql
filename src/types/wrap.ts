import type { NonNull } from './util.js';

export type WrapTok = 'l' | '!';
/** Outer-to-inner wrapper tuple. `[]` means "nullable named type". */
export type Wrap = readonly WrapTok[];

export type Apply<W extends Wrap, T> = W extends readonly ['!', ...infer R]
  ? R extends Wrap
    ? NonNull<Apply<R, T>>
    : never
  : W extends readonly ['l', ...infer R]
    ? R extends Wrap
      ? Apply<R, T>[] | null
      : never
    : T | null;
