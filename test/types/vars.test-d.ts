import type { ArgSpec, ArgsInput, VarMarker, VarProxy, VarsOf } from '../../src/types/vars.js';
import type { Simplify } from '../../src/types/util.js';

type Expect<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Spec = { name: string; email: string; age?: number };

// 1. every arg a variable -> one entry per arg, named after the arg key
type _1 = Expect<
  Eq<Simplify<VarsOf<{ name: VarMarker; email: VarMarker }, Spec>>, { name: string; email: string }>
>;

// 2. literals contribute nothing
type _2 = Expect<Eq<Simplify<VarsOf<{ name: string; email: VarMarker }, Spec>>, { email: string }>>;

// 3. an OPTIONAL arg produces an OPTIONAL variable
type _3 = Expect<Eq<Simplify<VarsOf<{ age: VarMarker }, Spec>>, { age?: number }>>;

// 4. an explicitly named marker overrides the arg key
type _4 = Expect<Eq<Simplify<VarsOf<{ name: VarMarker<'userName'> }, Spec>>, { userName: string }>>;

// 5. the proxy cannot preserve the literal key — this is why the arg key names it
declare const $: VarProxy;
type _5 = Expect<Eq<typeof $.anything, VarMarker>>;

// 6. `$` is not callable: `$.name` must be a marker, never `Function['name']`
type _6 = Expect<Eq<typeof $.name, VarMarker>>;

// 7. args accept a literal OR a marker in every slot
declare const ok: ArgsInput<Spec>;
const a: typeof ok = { name: 'x', email: $.email, age: 3 };
export { a };

// 8. no args at all must resolve to `{}`, never `unknown` (regression guard for
// `UnionToIntersection<never>` leaking `unknown` through `VarsOf`)
type _8 = Expect<Eq<VarsOf<{}, Spec>, {}>>;

// 9. ArgSpec accepts a `gql` record of GraphQL type strings, and its phantom
// `__t` carries the argument type through
declare const spec: ArgSpec<{ name: string }>;
const g: typeof spec.gql = { name: 'String!' };
export { g };
type _9 = Expect<Eq<NonNullable<ArgSpec<{ name: string }>['__t']>, { name: string }>>;
