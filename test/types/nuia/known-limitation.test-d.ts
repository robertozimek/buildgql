// Compiled under `noUncheckedIndexedAccess: true` (see the tsconfig beside this file)
// to PIN a known limitation, not to endorse it.
//
// `VarProxy` is an index signature (`{ readonly [K in string]: VarMarker }`), so under
// this flag `$.anything` widens to `VarMarker<string> | undefined`. That is not assignable
// to `Arg<T>`, so `$`-style variables do not compile for consumers who enable the flag.
// `v('name')` is unaffected and is the documented workaround.
//
// If this file starts failing, `VarProxy` was fixed — delete this fixture and update the
// `## Requirements` section of README.md.
import type { VarMarker, VarProxy } from '../../../src/types/vars.js';

declare const $: VarProxy;

// The limitation itself: reading any key yields `| undefined` under this flag.
const marker: VarMarker | undefined = $.userId;
void marker;

// @ts-expect-error — this is the whole problem: it should be assignable, and is not.
const narrowed: VarMarker = $.userId;
void narrowed;
