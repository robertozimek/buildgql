import type { VarsArg } from '../../src/types/varargs.js';

// A stand-in for any adapter/client function that takes an operation's variables as
// its trailing parameter. Exercising `VarsArg` through a call signature (rather than
// comparing tuple types directly) is what actually pins the caller-facing behaviour.
declare function takeVars<V>(...rest: VarsArg<V>): V;

// A map with a required key forces the caller to pass one...
const withRequired = takeVars<{ id: string }>({ id: 'x' });
// @ts-expect-error a variables map with a required key cannot be omitted
const missing = takeVars<{ id: string }>();
// @ts-expect-error wrong variable type
const wrongType = takeVars<{ id: string }>({ id: 1 });

// ...while an all-optional map must NOT force a positional argument. This is the same
// regression `HasVars` guards for `client.execute` — a `keyof V extends never` version
// cannot tell `{ note?: string }` apart from `{ note: string }`.
const omitted = takeVars<{ note?: string }>();
const supplied = takeVars<{ note?: string }>({ note: 'hi' });

// An operation with no variables at all is the same case.
const empty = takeVars<{}>();

export { withRequired, missing, wrongType, omitted, supplied, empty };
