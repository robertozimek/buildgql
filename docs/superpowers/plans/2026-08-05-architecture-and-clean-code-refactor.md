# Architecture & Clean Code Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring buildql's module boundaries, naming, and type-safety posture up to a consistently enforced standard — mechanically checked by a linter — without changing what the library does.

**Architecture:** The codebase is already well-decomposed (28 source files, 2,053 lines, heavy load-bearing comments). This is not a rewrite. Work proceeds in four layers, bottom-up: (1) install the tooling that makes conventions enforceable, (2) rename types and files onto one consistent scheme, (3) split the three modules that carry more than one responsibility (`subscribe.ts`, `introspect.ts`, `cli/index.ts`), (4) lock the public surface behind a test. Every task ends green on `npm run check` plus the newly added `npm run lint`.

**Tech Stack:** TypeScript 5.9 (strict), Vitest 2, tsup 8, ESLint 9 flat config + typescript-eslint, Prettier 3, graphql 16 (optional peer).

## Global Constraints

Every task's requirements implicitly include this section.

- **Node floor:** `>=18`. Do not use APIs newer than Node 18 in `src/`.
- **`graphql` is an OPTIONAL peer dependency.** `src/index.ts`, `src/client/**`, `src/runtime/**`, and `src/types/**` MUST NOT import it, at type level or runtime. Only `src/adapters/**` and the SDL branch of the schema loader may, and the latter only via dynamic `import()` inside a `try`/`catch`.
- **No `any`.** Commit `bad64a2` eliminated it deliberately. `unknown` plus a documented cast is the house style.
- **Type-performance budget is a hard gate:** `npm run test:perf` enforces ≤ 25,000 instantiations and ≤ 3s check time on `test/perf/generated.ts`. Do not add generic indirection to `src/types/**` or `src/runtime/builders.ts` without re-running it.
- **Every deliberate cast keeps its explanatory comment.** The `as unknown as` casts in `builders.ts`, `fragment.ts`, and `directives.ts` are phantom-type attachments and are already documented. Renaming may reflow those comments; deleting them is a regression.
- **Error messages stay `buildql:`-prefixed.** Every `throw new Error` and every `process.std*` write in `src/` begins with the literal `buildql: `.
- **The generated module's default (`client: 'buildql'`) import block stays a single merged, sorted `from 'buildql'` statement** with `$` and `v` pinned last — see the comment on `importBlock` in `src/codegen/emit.ts`. The *names* in it change in Task 5; the shape does not.
- **`npm run check` (`test:types` + `test` + `test:perf`) and `npm run lint` MUST pass at the end of every task.**

## Naming Decisions (reference for all tasks)

Settled once here so later tasks don't drift. The package is **not published to npm** (`npm view buildql` → 404), so public renames cost nothing externally.

| Current | New | Why |
|---|---|---|
| `Node` (type) | `SelectionNode` | `Node` collides with DOM `Node`, which is in `lib` |
| `AnySel` | `AnyFieldSelection` | spells out what it is |
| `Sel<N,R,V,O>` | `FieldSelection<N,R,V,O>` | ditto |
| `On<TN,R,V>` (type) | `InlineFragment<TN,R,V>` | `On` is meaningless as an exported type |
| `Spread<R,V>` | `FragmentSpread<R,V>` | matches GraphQL vocabulary |
| `SpreadTarget` | `FragmentDefinition` | it *is* a fragment definition |
| `FragmentDef` (alias in `print.ts`) | **deleted** | pure alias of the above |
| `FragmentHandle<R,V>` | `Fragment<R,V>` | `spread(fragment)` reads better |
| `Spread.handle` | `FragmentSpread.fragment` | ditto |
| `DirectiveNode` | `Directive` | collides with graphql-js `DirectiveNode` |
| `args()` | `argSpec()` | returns an `ArgSpec`; `args` is too generic for a root export |
| `leaf()` | `leafField()` | consistent `<kind>Field[Args]` family |
| `leafArgs()` | `leafFieldArgs()` | ditto |
| `object()` | `objectField()` | `object` is far too generic for a root export |
| `objectArgs()` | `objectFieldArgs()` | ditto |
| `GraphQLResponseError` | `BuildQLResponseError` | consistent `BuildQL` prefix |
| — | `BuildQLError` (new abstract base) | lets consumers write one `instanceof` |
| `src/types/node.ts` | `src/types/selection.ts` | file follows the type |
| `src/types/varargs.ts` | **merged into** `src/types/vars.ts` | both describe variables |
| `src/client/client.ts` | `src/client/create-client.ts` + `src/client/index.ts` | removes the `client/client` stutter |

**Function naming rule:** `makeX` = returns a *builder function*; `toX` = pure conversion; `isX` = type-guard predicate; `assertX` = throws or narrows; `collectX` = walks a tree accumulating. All existing code already follows this — keep it.

**File naming rule:** kebab-case, one responsibility per file. Enforced by `unicorn/filename-case` in Task 1.

---

### Task 1: Lint and format tooling

Nothing mechanically enforces any convention today — no ESLint, no Prettier, no `.editorconfig`, no `lint` script, and CI runs only `check` + `build`. This lands first so every later task is gated by it.

**Files:**
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Modify: `package.json` (devDependencies, `lint`/`format` scripts, `check` script)
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nothing
- Produces: `npm run lint` (ESLint, zero warnings tolerated) and `npm run format:check` (Prettier), both wired into `npm run check`. Later tasks rely on these existing.

- [ ] **Step 1: Install the tooling**

```bash
npm install --save-dev eslint@^9 @eslint/js@^9 typescript-eslint@^8 eslint-config-prettier@^9 eslint-plugin-unicorn@^56 prettier@^3
```

- [ ] **Step 2: Write the Prettier config**

Values chosen to match the code already in the repo (single quotes, semicolons, trailing commas, 2-space indent), so the reformat in Step 6 is confined to line wrapping.

Create `.prettierrc.json`:

```json
{
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "tabWidth": 2,
  "printWidth": 110
}
```

Create `.prettierignore`:

```
dist
node_modules
test/perf/generated.ts
test/perf/tsconfig.json
package-lock.json
```

- [ ] **Step 3: Write the ESLint flat config**

`test/perf/generated.ts` and `dist` are ignored — the first is machine-written, the second is build output. Three rules are deliberately disabled with the reason inline; do not "clean them up" later.

`tsconfig.json` sets `include: ["src", "test"]`, so the config files and build scripts are outside the TypeScript project — `projectService` errors on any file it cannot find in a project. They are ignored rather than linted; enlarging the tsconfig's `include` just to lint them would widen what `npm run test:types` checks.

Create `eslint.config.js`:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      // Machine-written.
      'test/perf/generated.ts',
      'test/perf/tsconfig.json',
      // Outside tsconfig's `include`, so `projectService` cannot type them.
      'eslint.config.js',
      'tsup.config.ts',
      'vitest.config.ts',
      '**/*.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { unicorn },
    rules: {
      // The naming scheme documented in docs/superpowers/plans — types PascalCase,
      // values camelCase, module-level constants either camelCase or UPPER_CASE.
      // `leadingUnderscore: 'allow'` covers deliberately-unused params like `_wrap`.
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'interface', format: ['PascalCase'], custom: { regex: '^I[A-Z]', match: false } },
        { selector: 'function', format: ['camelCase'] },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'], leadingUnderscore: 'allow' },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        // Object literal keys are GraphQL field names and wire-protocol keys
        // (`__typename`, `content-type`, `connection_init`) — not ours to rename.
        { selector: 'objectLiteralProperty', format: null },
        { selector: 'typeProperty', format: null },
      ],
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',

      // `{}` is load-bearing here: it is the "this selection contributes no
      // variables" identity, and `UnionToIntersection` in src/types/util.ts
      // normalises the empty union to it on purpose. Banning it would force
      // `Record<string, never>`, which does NOT intersect the same way.
      '@typescript-eslint/no-empty-object-type': 'off',

      // The builders carry phantom type parameters (`W`, `T`, `Spec`) that appear
      // only inside `as unknown as` casts. The rule cannot see that use and
      // reports every one of them as unnecessary.
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
    },
  },
  {
    // Phantom-type attachment lives here and nowhere else — builders.ts,
    // fragment.ts and directives.ts each document why the cast is load-bearing.
    // Scoped rather than project-wide so a genuinely redundant assertion in the
    // client, codegen or adapters still gets reported.
    files: ['src/runtime/**/*.ts'],
    rules: { '@typescript-eslint/no-unnecessary-type-assertion': 'off' },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      // Type tests assert on unused locals and deliberately-wrong calls.
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  prettier,
);
```

- [ ] **Step 4: Add the scripts**

In `package.json`, replace the `scripts` block with:

```json
  "scripts": {
    "build": "tsup",
    "lint": "eslint . --max-warnings 0",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:types": "tsc -p tsconfig.typetest.json",
    "test:perf": "node scripts/typeperf.mjs",
    "check": "npm run lint && npm run format:check && npm run test:types && npm run test && npm run test:perf"
  },
```

- [ ] **Step 5: Run the linter and triage what it reports**

Run: `npm run lint`

Expected: a small number of findings, since the three high-noise rules are already disabled above. Fix each one in `src/` on its merits — do NOT add blanket disables.

Two findings are predictable, both from `recommendedTypeChecked`:

**`@typescript-eslint/no-floating-promises`** on the module-scope entrypoint call in `src/cli/index.ts`. Fix it in place (Task 12 deletes this block entirely, but the tree must be green now):

```ts
if (isEntrypoint(import.meta.url, process.argv[1])) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
```

**`@typescript-eslint/no-misused-promises`** on `socket.onopen = async () => {...}` in `src/client/subscribe.ts:125` — an async function assigned to a void-returning handler. The pattern is deliberate and already documented there (the body awaits `connectionParams()` and routes any throw through the failure path precisely *because* nothing awaits `onopen`). Add a targeted disable that says so:

```ts
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- the async
      // body is deliberate; see the comment inside about routing throws to `failure`.
      socket.onopen = async () => {
```

Task 9 rewrites this file into `ws-transport.ts`; carry the disable comment across with it.

If any rule not listed above produces more than ~5 findings across `src/`, that is a signal the rule is wrong for this codebase, not that the codebase is wrong — disable it in `eslint.config.js` with a one-line comment saying why, in the same style as the three above.

- [ ] **Step 6: Commit the config, then reformat as a separate commit**

Two commits so the formatting churn does not hide the config in review.

```bash
git add package.json package-lock.json eslint.config.js .prettierrc.json .prettierignore
git add src/cli/index.ts
git commit -m "chore: add eslint and prettier with enforced naming conventions"
```

Then:

```bash
npm run format
npm run check
git add -A
git commit -m "style: apply prettier formatting"
```

- [ ] **Step 7: Wire it into CI**

`npm run check` now includes lint and format, so CI needs no new step — but pin the intent by naming it. Replace the `- run: npm run check` line in `.github/workflows/ci.yml` with:

```yaml
      - run: npm run check
        name: Lint, format, types, tests, type-perf budget
```

- [ ] **Step 8: Verify and commit**

Run: `npm run check`
Expected: PASS (lint, format:check, tsc, vitest, perf budget)

```bash
git add .github/workflows/ci.yml
git commit -m "ci: name the check step for what it now covers"
```

---

### Task 2: Enable `exactOptionalPropertyTypes`

Measured fallout: exactly **2 errors, both in `src/`**. (`noUncheckedIndexedAccess` is deliberately NOT enabled here — see Task 3.)

**Files:**
- Modify: `tsconfig.json:8`
- Modify: `src/codegen/introspect.ts:83-86`
- Modify: `src/client/client.ts:57-66`

**Interfaces:**
- Consumes: Task 1's `npm run lint`
- Produces: the project convention that an optional property which may legitimately receive an explicit `undefined` is declared `?: T | undefined`, not `?: T`.

- [ ] **Step 1: Flip the flag**

In `tsconfig.json`, change line 8:

```json
    "exactOptionalPropertyTypes": true,
```

- [ ] **Step 2: Run the type checker to see it fail**

Run: `npm run test:types`
Expected: FAIL with exactly two errors —
`src/cli/index.ts(21,43): error TS2379` (headers) and `src/client/client.ts(57,46): error TS2769` (signal).

- [ ] **Step 3: Widen `LoadOptions.headers`**

`generate()` passes `config.headers`, which is `Record<string, string> | undefined` because `BuildQLConfig.headers` is optional. Under the flag, an optional property no longer implicitly accepts an explicit `undefined`. In `src/codegen/introspect.ts`, replace the `LoadOptions` interface:

```ts
export interface LoadOptions {
  /** `| undefined` is explicit: callers forward a possibly-absent `config.headers` directly. */
  readonly headers?: Record<string, string> | undefined;
  readonly fetch?: typeof fetch;
}
```

- [ ] **Step 4: Normalise the abort signal**

`RequestInit.signal` is typed `AbortSignal | null`, and `opts?.signal` is `AbortSignal | undefined`. In `src/client/client.ts`, in the `doFetch` call inside `execute`, change the `signal` line:

```ts
      const res = await doFetch(options.url, {
        method: 'POST',
        headers,
        // `RequestInit.signal` is `AbortSignal | null`; `??` bridges our `undefined`.
        signal: opts?.signal ?? null,
        body: JSON.stringify({
          query: op.document,
          operationName: op.name,
          variables: vars ?? {},
        }),
      });
```

- [ ] **Step 5: Verify and commit**

Run: `npm run check`
Expected: PASS

```bash
git add tsconfig.json src/codegen/introspect.ts src/client/client.ts
git commit -m "chore(types): enable exactOptionalPropertyTypes"
```

---

### Task 3: Pin the `noUncheckedIndexedAccess` incompatibility

Under `noUncheckedIndexedAccess`, `src/` has **zero** errors but the type tests have **68**, all from one root cause: `VarProxy` is `{ readonly [K in string]: VarMarker }` — an index signature — so `$.userId` reads as `VarMarker<string> | undefined`, which is not assignable to `Arg<T>`, which collapses `VarsOf` and then `Selected<S>` to `{}`.

This is not an internal problem. **Any consumer whose own tsconfig sets the flag hits it**, and it is currently undocumented. Fixing it properly means either widening `Arg<T>` to accept `undefined` (which would let `{ name: undefined }` satisfy a *required* argument — a real safety loss) or replacing `$.userId` with a callable `$('userId')` (which makes `$` redundant with the existing `v()`). Both are public-API design decisions. This task **documents and tests the limitation** rather than picking one.

**Files:**
- Create: `test/types/nuia/tsconfig.json`
- Create: `test/types/nuia/known-limitation.test-d.ts`
- Modify: `package.json` (`test:types` script)
- Modify: `README.md` (the `## Requirements` section, line 255)

**Interfaces:**
- Consumes: Task 2's tsconfig
- Produces: `npm run test:types` additionally compiles the NUIA fixture, so the day someone fixes `VarProxy` this test fails loudly and tells them to update the docs.

- [ ] **Step 1: Write the fixture that pins current behaviour**

Create `test/types/nuia/known-limitation.test-d.ts`:

```ts
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
```

- [ ] **Step 2: Write the fixture's tsconfig**

Create `test/types/nuia/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "noUncheckedIndexedAccess": true
  },
  "include": ["known-limitation.test-d.ts"],
  "exclude": []
}
```

- [ ] **Step 3: Run it to confirm it compiles clean**

Run: `npx tsc -p test/types/nuia/tsconfig.json`
Expected: PASS with no output. (If the `@ts-expect-error` is reported as unused, `VarProxy` has already been fixed — stop and revisit this task.)

- [ ] **Step 4: Wire it into `test:types`**

In `package.json`:

```json
    "test:types": "tsc -p tsconfig.typetest.json && tsc -p test/types/nuia/tsconfig.json",
```

- [ ] **Step 5: Document it for users**

In `README.md`, under `## Requirements`, append:

```markdown
### Known limitation: `noUncheckedIndexedAccess`

`$.argName` does not type-check in projects that enable TypeScript's
`noUncheckedIndexedAccess`. The `$` proxy is typed as an index signature, so under that
flag every read widens to `VarMarker | undefined`, which the argument types reject.

Use the explicit form instead — it is unaffected:

```ts
import { v } from 'buildql';

const q = query('User', ($, Q) => [Q.user({ id: v('id') }, (U) => [U.name])]);
```
```

- [ ] **Step 6: Verify and commit**

Run: `npm run check`
Expected: PASS

```bash
git add test/types/nuia package.json README.md
git commit -m "docs(types): pin and document the noUncheckedIndexedAccess limitation"
```

---

### Task 4: Rename and consolidate the type layer

`Node` collides with DOM `Node` (which is in `lib`), `DirectiveNode` collides with graphql-js's, `On`/`Sel`/`AnySel` are cryptic, `SpreadTarget` and `FragmentDef` are two names for one concept, `varargs.ts` holds a general-purpose utility (`RequiredKeys`) plus variable-call types that belong with the other variable types, and `select.ts:57` re-exports eight types it does not own — creating two import paths for each.

**Files:**
- Create: `src/types/selection.ts` (from `src/types/node.ts`)
- Delete: `src/types/node.ts`
- Delete: `src/types/varargs.ts`
- Modify: `src/types/vars.ts` (absorbs `HasVars`, `VarsArg`)
- Modify: `src/types/util.ts` (absorbs `RequiredKeys`)
- Modify: `src/types/select.ts` (drop the pass-through re-export)
- Modify: `src/runtime/print.ts`, `src/runtime/builders.ts`, `src/runtime/fragment.ts`, `src/runtime/directives.ts`, `src/runtime/on.ts`, `src/runtime/operation.ts`
- Modify: `src/client/client.ts`, `src/adapters/apollo.ts`, `src/adapters/urql.ts`, `src/index.ts`
- Modify: `test/types/*.test-d.ts`, `test/unit/*.test.ts` (import paths and type names)

**Interfaces:**
- Consumes: Task 2's tsconfig
- Produces: `src/types/selection.ts` exporting `VarRef`, `Directive`, `FieldSelection<N, R, V = {}, O extends boolean = false>`, `FragmentDefinition`, `FragmentSpread<R, V = {}>`, `InlineFragment<TN, R, V = {}>`, `AnyFieldSelection`, `SelectionNode`. `src/types/vars.ts` additionally exports `HasVars<V>` and `VarsArg<V>`. `src/types/util.ts` additionally exports `RequiredKeys<V>`. Tasks 5–12 import from these.

- [ ] **Step 1: Create `src/types/selection.ts`**

This is `src/types/node.ts` with the renames from the table applied. Note `FragmentSpread.handle` becomes `.fragment`.

```ts
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
  | AnyFieldSelection
  | FragmentSpread<unknown, unknown>
  | InlineFragment<string, unknown, unknown>;
```

- [ ] **Step 2: Delete the old file**

```bash
git rm src/types/node.ts
```

- [ ] **Step 3: Move `RequiredKeys` into `util.ts`**

Append to `src/types/util.ts`:

```ts
/** Keys of `V` that are not optional. */
export type RequiredKeys<V> = { [K in keyof V]-?: {} extends Pick<V, K> ? never : K }[keyof V];
```

- [ ] **Step 4: Fold the rest of `varargs.ts` into `vars.ts`**

Append to `src/types/vars.ts` (and add `RequiredKeys` to its existing `import type` from `./util.js`):

```ts
/**
 * True when the operation declared at least one REQUIRED variable — an all-optional
 * variable map (e.g. `{ after?: string }`) must not force a positional `vars` argument.
 */
export type HasVars<V> = RequiredKeys<V> extends never ? false : true;

/**
 * The trailing parameter list carrying an operation's variables, and nothing else.
 * `NoInfer` stops `V` being re-inferred from the argument, which would otherwise let a
 * pre-declared object with missing keys through silently.
 *
 * `client.execute`/`client.subscribe` need a second `ExecuteOptions` slot as well, so they
 * build their own tuple from `HasVars` rather than using this alias — see `create-client.ts`.
 */
export type VarsArg<V> = HasVars<V> extends true ? [vars: NoInfer<V>] : [vars?: NoInfer<V>];
```

Then delete the old file:

```bash
git rm src/types/varargs.ts
```

- [ ] **Step 5: Drop the pass-through re-export from `select.ts`**

Delete line 57 of `src/types/select.ts` entirely:

```ts
export type { AnySel, Node, On, Sel, Spread, KEY, RESULT, VARS };
```

Update its own imports on lines 1–2 to the new names:

```ts
import type { AnyFieldSelection, FieldSelection, FragmentSpread, InlineFragment, SelectionNode } from './selection.js';
import type { VARS } from './symbols.js';
import type { Simplify, UnionToIntersection } from './util.js';
```

and rename the local helpers' references (`Sel` → `FieldSelection`, `Node` → `SelectionNode`, `Spread` → `FragmentSpread`, `On` → `InlineFragment`) throughout the file. `AnyFieldSelection` and the `KEY`/`RESULT` imports are no longer used once the re-export line is gone — remove them from the import list if the linter reports them unused.

- [ ] **Step 6: Update every consumer**

Mechanical rename across `src/` and `test/`. The old identifiers are distinctive enough to find exactly:

```bash
grep -rln "types/node.js\|types/varargs.js\|\bAnySel\b\|\bSpreadTarget\b\|\bDirectiveNode\b" src test
```

Apply, per file: `types/node.js` → `types/selection.js`; `types/varargs.js` → `types/vars.js`; `Node` → `SelectionNode`; `Sel` → `FieldSelection`; `AnySel` → `AnyFieldSelection`; `On` → `InlineFragment` (the *type* only — the exported `on()` function keeps its name); `Spread` → `FragmentSpread`; `SpreadTarget` → `FragmentDefinition`; `DirectiveNode` → `Directive`; `.handle` → `.fragment` on spreads.

Two sites need more than a rename:

In `src/runtime/print.ts`, delete the `FragmentDef` alias (lines 3–4) and use `FragmentDefinition` directly:

```ts
import type {
  AnyFieldSelection,
  Directive,
  FragmentDefinition,
  FragmentSpread,
  InlineFragment,
  SelectionNode,
  VarRef,
} from '../types/selection.js';
```

and change `printOperation`'s parameter to `fragments: readonly FragmentDefinition[] = []`.

In `src/runtime/fragment.ts`, rename `FragmentHandle` → `Fragment` and update `spread()`:

```ts
export interface Fragment<R, V> extends FragmentDefinition {
  readonly [RESULT]?: R;
  readonly [VARS]?: V;
}

export function spread<R, V>(f: Fragment<R, V>): FragmentSpread<R, V> {
  // Phantom attachment only: `fragment: f` is the real runtime value already
  // shaped like `FragmentDefinition`; the cast exists solely to stamp the `R`/`V`
  // type parameters onto the returned `FragmentSpread`.
  return { kind: 'spread', fragment: f } as unknown as FragmentSpread<R, V>;
}
```

and inside `collectFragments`, `n.handle` becomes `n.fragment` at all four sites.

- [ ] **Step 7: Update the public export list**

In `src/index.ts`, replace lines 10, 14, and 16:

```ts
export type { Fragment } from './runtime/fragment.js';
```

(delete the `FragmentDef` export line entirely)

```ts
export type {
  AnyFieldSelection,
  Directive,
  FieldSelection,
  FragmentDefinition,
  FragmentSpread,
  InlineFragment,
  SelectionNode,
  VarRef,
} from './types/selection.js';
```

- [ ] **Step 8: Verify and commit**

Run: `npm run check`
Expected: PASS

```bash
git add -A src test
git commit -m "refactor(types): rename selection types onto one scheme, merge varargs into vars"
```

---

### Task 5: Unify internal markers on symbols

There are two conventions for the same job. `src/runtime/var.ts` brands variable placeholders with `Symbol.for('buildql.var')`, while `builders.ts` and `print.ts` use structural string keys — `{ __enum: value }` and `{ __varRef: name }` — detected with `typeof x.__enum === 'string'`. Beyond the inconsistency, the string form is a correctness hazard: a user passing an input object that legitimately contains a `__enum` or `__varRef` key has it silently reinterpreted as a marker.

Symbols are safe here because these values are printed into the GraphQL document by `printValue` and never cross a JSON boundary. `Symbol.for` (not `Symbol()`) is required: the dual ESM/CJS build means two copies of a module can coexist in one process, exactly as documented on the `WeakMap` in `src/adapters/document.ts`.

**Files:**
- Create: `src/runtime/markers.ts`
- Modify: `src/runtime/var.ts`
- Modify: `src/runtime/builders.ts:12-40`
- Modify: `src/runtime/print.ts:6-31, 71`
- Test: `test/unit/print.test.ts`

**Interfaces:**
- Consumes: Task 4's `src/types/selection.ts`
- Produces: `src/runtime/markers.ts` exporting `isVarMarker(x): x is VarMarker`, `makeVarMarker(name: string | null): VarMarker`, `markerName(m: VarMarker): string | null`, `enumValue(v: string): EnumValue`, `isEnumValue(x): x is EnumValue`, `varRefValue(name: string): VarRefValue`, `isVarRefValue(x): x is VarRefValue`.

- [ ] **Step 1: Write the failing test**

Append to `test/unit/print.test.ts` (adjust the existing import line to include what you need):

```ts
import { leafArgs, objectArgs, args } from '../../src/runtime/builders.js';
import { makeQuery } from '../../src/runtime/operation.js';

it('does not mistake a user input object with a __enum key for an enum value', () => {
  const Root = {
    search: leafArgs<'search', ['!'], string, { filter: { __enum: string } }>(
      'search',
      ['!'],
      args<{ filter: { __enum: string } }>({ filter: 'FilterInput!' }),
    ),
  };
  const q = makeQuery(Root)('Search', (_$, R) => [R.search({ filter: { __enum: 'NOT_AN_ENUM' } })]);
  expect(q.document).toContain('{__enum: "NOT_AN_ENUM"}');
  expect(q.document).not.toContain('filter: NOT_AN_ENUM');
});

it('does not mistake a user input object with a __varRef key for a variable', () => {
  const Root = {
    search: leafArgs<'search', ['!'], string, { filter: { __varRef: string } }>(
      'search',
      ['!'],
      args<{ filter: { __varRef: string } }>({ filter: 'FilterInput!' }),
    ),
  };
  const q = makeQuery(Root)('Search', (_$, R) => [R.search({ filter: { __varRef: 'nope' } })]);
  expect(q.document).toContain('{__varRef: "nope"}');
  expect(q.document).not.toContain('$nope');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/print.test.ts`
Expected: FAIL — both assertions, because `printValue` reads the string keys structurally and emits `NOT_AN_ENUM` / `$nope`.

- [ ] **Step 3: Write `src/runtime/markers.ts`**

```ts
import type { VarMarker } from '../types/vars.js';

// `Symbol.for`, not `Symbol()`: the dual ESM/CJS build can put two copies of this
// module in one process (see the note on the document cache in
// src/adapters/document.ts), and markers made by one must be recognised by the other.
const VAR = Symbol.for('buildql.var');
const ENUM = Symbol.for('buildql.enum');
const VAR_REF = Symbol.for('buildql.varRef');

interface RuntimeVarMarker {
  readonly [VAR]: true;
  /** `null` means "take the name from the argument key". */
  readonly __var: string | null;
}

/** A GraphQL enum literal, which must print unquoted. */
export interface EnumValue {
  readonly [ENUM]: string;
}

/** A resolved `$name` reference standing in an argument position. */
export interface VarRefValue {
  readonly [VAR_REF]: string;
}

export function makeVarMarker(name: string | null): VarMarker {
  return { [VAR]: true, __var: name } as unknown as VarMarker;
}

export function isVarMarker(x: unknown): x is VarMarker {
  return typeof x === 'object' && x !== null && (x as Record<symbol, unknown>)[VAR] === true;
}

/** The explicit name, or `null` when the marker came from `$`. */
export function markerName(m: VarMarker): string | null {
  return (m as unknown as RuntimeVarMarker).__var;
}

export function enumValue(value: string): EnumValue {
  return { [ENUM]: value };
}

export function isEnumValue(x: unknown): x is EnumValue {
  return typeof x === 'object' && x !== null && typeof (x as Record<symbol, unknown>)[ENUM] === 'string';
}

export function varRefValue(name: string): VarRefValue {
  return { [VAR_REF]: name };
}

export function isVarRefValue(x: unknown): x is VarRefValue {
  return typeof x === 'object' && x !== null && typeof (x as Record<symbol, unknown>)[VAR_REF] === 'string';
}

export { ENUM, VAR, VAR_REF };
```

- [ ] **Step 4: Reduce `var.ts` to the public `$`/`v` surface**

Replace the whole of `src/runtime/var.ts`:

```ts
import type { VarMarker, VarProxy } from '../types/vars.js';
import { makeVarMarker } from './markers.js';

export { isVarMarker, markerName } from './markers.js';

/**
 * Placeholder proxy. The accessed key is deliberately ignored: a mapped type
 * over `string` cannot preserve it, so the type system names the variable after
 * the *argument key* instead. Recording `null` here keeps runtime and types in
 * agreement — see `splitArgs` in builders.ts.
 */
export const $: VarProxy = new Proxy({} as VarProxy, {
  get() {
    return makeVarMarker(null);
  },
});

/** Explicitly name a variable — use when two fields would collide on an arg key. */
export function v<N extends string>(name: N): VarMarker<N> {
  return makeVarMarker(name) as VarMarker<N>;
}
```

- [ ] **Step 5: Switch `builders.ts` to the symbol constructors**

In `src/runtime/builders.ts`, change the import on line 5 and the two marker-producing sites:

```ts
import { enumValue, isVarMarker, markerName, varRefValue } from './markers.js';
```

```ts
function markEnums(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(markEnums);
  return typeof value === 'string' ? enumValue(value) : value;
}
```

and inside `splitArgs`, replace the literal assignment:

```ts
      varRefs.push({ varName, gqlType });
      literals[key] = varRefValue(varName);
```

- [ ] **Step 6: Switch `print.ts` to the symbol predicates**

In `src/runtime/print.ts`, delete the local `VarRefMarker` interface and `isVarRefMarker` function (lines 6–12), add the import, and rewrite `printValue`'s first three branches. Note `Object.entries` does not enumerate symbol keys, so the trailing object branch cannot see a marker's brand — the ordering below keeps that from mattering.

```ts
import { ENUM, VAR_REF, isEnumValue, isVarRefValue } from './markers.js';
```

```ts
/** GraphQL value literal serialisation. Enum values arrive pre-marked by codegen. */
function printValue(value: unknown): string {
  if (isVarRefValue(value)) return `$${value[VAR_REF]}`;
  if (value === null || value === undefined) return 'null';
  if (isEnumValue(value)) return value[ENUM];
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(printValue).join(', ')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${printValue(v)}`);
    return `{${entries.join(', ')}}`;
  }
  throw new Error(`buildql: cannot serialise argument value of type ${typeof value}`);
}
```

- [ ] **Step 7: Make `collectVarRefs` module-private**

It is exported but has exactly one caller — `dedupeVarRefs`, in the same file — and is not part of the public API. Drop the `export` keyword on line 71 of `src/runtime/print.ts`:

```ts
/** Walks the whole tree, including inline fragments, spreads and directives. */
function collectVarRefs(sels: readonly SelectionNode[]): VarRef[] {
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run test/unit/print.test.ts test/unit/builders.test.ts test/unit/operation.test.ts`
Expected: PASS, including the two new collision tests.

- [ ] **Step 9: Verify and commit**

Run: `npm run check`
Expected: PASS

```bash
git add -A src test
git commit -m "refactor(runtime): unify internal markers on symbols, fixing __enum/__varRef collisions"
```

---

### Task 6: Rename the field builders

`args`, `object`, and `leaf` are extremely generic identifiers for root exports of a published package, and `object` in particular reads badly at the top of every generated module. The family becomes `argSpec` plus `<kind>Field[Args]`. The four near-identical three-line cast comments in this file collapse to one file-level note.

**Deliberate non-change:** the four `Object.assign(make(undefined), { as })` blocks stay duplicated. Abstracting them behind a generic `withAlias<Base, AsFn>()` helper would add generic indirection to the hottest path in the type checker, and `npm run test:perf` enforces a 25,000-instantiation budget. DRY loses to the measured constraint here.

**Files:**
- Modify: `src/runtime/builders.ts`
- Modify: `src/index.ts:7`
- Modify: `src/codegen/emit.ts:12-26, 114-125`
- Modify: `test/perf/schema.gen.mjs:5, 8, 10`
- Modify: `test/unit/builders.test.ts`, `test/unit/print.test.ts`, `test/unit/emit.test.ts`, `test/types/*.test-d.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 5's `markers.ts`
- Produces: `argSpec<T>(gql, enums?)`, `leafField<N, W, T>(name, wrap)`, `leafFieldArgs<N, W, T, Spec>(name, wrap, spec)`, `objectField<N, W, F>(name, wrap, fields)`, `objectFieldArgs<N, W, F, Spec>(name, wrap, fields, spec)`. The emitter and every generated module use these names.

- [ ] **Step 1: Write the failing emitter test**

Append inside the existing `describe('emit', ...)` block in `test/unit/emit.test.ts`, reusing its `generated()` helper (defined at the top of that file):

```ts
  it('emits the renamed builder family', async () => {
    const src = await generated();
    expect(src).toContain('import {\n  argSpec,');
    expect(src).toContain('leafField<');
    expect(src).toContain("objectField('");
    // The old generic names must be gone entirely.
    expect(src).not.toMatch(/\bobject\(/);
    expect(src).not.toMatch(/\bleaf</);
    expect(src).not.toMatch(/\bargs</);
  });
```

Several existing assertions in this file pin the old names (e.g. `"id: leaf<'id', ['!'], string>('id', ['!'])"`) — Step 7's grep catches them.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/emit.test.ts`
Expected: FAIL — the emitted source still says `args`, `leaf`, `object`.

- [ ] **Step 3: Rename in `builders.ts`**

Apply these renames in `src/runtime/builders.ts`: `args` → `argSpec`, `leaf` → `leafField`, `leafArgs` → `leafFieldArgs`, `object` → `objectField`, `objectArgs` → `objectFieldArgs`, and the private `node` → `makeFieldNode`.

Then replace the four repeated cast comments with one note directly above `leafField`, and reduce each site to a one-line pointer:

```ts
/**
 * PHANTOM CASTS IN THIS FILE
 *
 * Every `as unknown as` below is a phantom-type attachment. The value produced by
 * `makeFieldNode(...)` (or by `make(alias)`) is already the complete runtime value;
 * the cast exists only to stamp type parameters — `N`/`AL`, `Apply<W, T>`,
 * `VarsOf<A, Spec>`, `VarsIn<S>` — that have no runtime representation at all.
 * None of them can be derived structurally from the runtime value.
 */

/** A scalar or enum field. `W` MUST be a `const` parameter or wrappers degrade. */
export function leafField<N extends string, const W extends Wrap, T>(
  name: N,
  _wrap: W,
): FieldSelection<N, Apply<W, T>> & { as<A extends string>(alias: A): FieldSelection<A, Apply<W, T>> } {
  const base = makeFieldNode(name, undefined, undefined, undefined, []);
  return Object.assign(base, {
    as<A extends string>(alias: A) {
      // Phantom cast — see the file note above.
      return makeFieldNode(name, alias, undefined, undefined, []) as unknown as FieldSelection<A, Apply<W, T>>;
    },
  }) as FieldSelection<N, Apply<W, T>> & { as<A extends string>(alias: A): FieldSelection<A, Apply<W, T>> };
}
```

Apply the same `// Phantom cast — see the file note above.` one-liner at the other seven cast sites.

- [ ] **Step 4: Update the public export**

In `src/index.ts`, line 7:

```ts
export { argSpec, leafField, leafFieldArgs, objectField, objectFieldArgs } from './runtime/builders.js';
```

- [ ] **Step 5: Update the emitter**

In `src/codegen/emit.ts`, replace `CORE_IMPORTS` (keeping it sorted, since `importBlock` re-sorts and the generated output depends on the order):

```ts
const CORE_IMPORTS = [
  'argSpec',
  'include',
  'leafField',
  'leafFieldArgs',
  'makeFragment',
  'makeMutation',
  'makeQuery',
  'makeSubscription',
  'objectField',
  'objectFieldArgs',
  'on',
  'skip',
  'spread',
];
```

and update the four emission sites — `argSpec()` in `argSpec(field, ir)`, and `leafField`/`leafFieldArgs`/`objectField`/`objectFieldArgs` in `emitField` and `emitTypeMap`:

```ts
function argSpec(field: IRField, ir: IRSchema): string {
  const gqlEntries = field.args.map((a) => `${a.name}: '${a.gqlType}'`).join(', ');
  const enumKeys = field.args.filter((a) => a.type.kind === 'enum').map((a) => `'${a.name}'`);
  const enumArg = enumKeys.length > 0 ? `, [${enumKeys.join(', ')}]` : '';
  return `argSpec<${argTsType(field, ir)}>({ ${gqlEntries} }${enumArg})`;
}
```

```ts
  if (!isComposite) {
    const ts = leafTsType(field.type, ir);
    if (field.args.length === 0) {
      return `  ${field.name}: leafField<'${field.name}', ${wrap}, ${ts}>('${field.name}', ${wrap}),`;
    }
    // `leafFieldArgs` cannot infer its result type `T`, and TypeScript has no partial
    // explicit type arguments — so all four are written out.
    return `  ${field.name}: leafFieldArgs<'${field.name}', ${wrap}, ${ts}, ${argTsType(field, ir)}>('${field.name}', ${wrap}, ${argSpec(field, ir)}),`;
  }

  // Getters defer resolution so cyclic type references work.
  if (field.args.length === 0) {
    return `  get ${field.name}() { return objectField('${field.name}', ${wrap}, ${field.type.name}) },`;
  }
  return `  get ${field.name}() { return objectFieldArgs('${field.name}', ${wrap}, ${field.type.name}, ${argSpec(field, ir)}) },`;
```

and in `emitTypeMap`, the `__typename` line:

```ts
  const typename = `  __typename: leafField<'__typename', ['!'], ${typenameTsType(t)}>('__typename', ['!']),`;
```

- [ ] **Step 6: Update the type-perf fixture generator**

In `test/perf/schema.gen.mjs`, lines 5, 8 and 10:

```js
const lines = [`import { leafField, objectField, makeQuery } from '../../src/index.js';`];
```

```js
    for (let i = 0; i < NF; i++) fs.push(`  f${i}: leafField<'f${i}', ['!'], string>('f${i}', ['!']),`);
    if (t > 0) fs.push(`  get child() { return objectField('child', ['!'], T${t - 1}); },`);
```

- [ ] **Step 7: Update the remaining call sites**

```bash
grep -rln "\bleafArgs\b\|\bobjectArgs\b\|\bleaf<\|\bleaf(\|\bobject(\|\bargs<\|\bargs(" src test README.md
```

Apply the renames in each hit. Watch for false positives: `field.args`, `IRField.args`, and `ArgsInput` are unrelated and must not change.

- [ ] **Step 8: Regenerate the perf fixture and verify**

Run: `npm run test:perf`
Expected: PASS, with instantiations still under 25,000. (The script regenerates `test/perf/generated.ts` from `schema.gen.mjs` before measuring.)

- [ ] **Step 9: Verify and commit**

Run: `npm run check`
Expected: PASS

```bash
git add -A src test README.md
git commit -m "refactor: rename field builders to argSpec and <kind>Field[Args]"
```

---

### Task 7: Give the errors a common base class

`BuildQLHttpError` carries the package prefix and `GraphQLResponseError` does not, and there is no shared supertype — a consumer cannot write one `catch` that distinguishes buildql's failures from anyone else's.

**Files:**
- Modify: `src/client/errors.ts`
- Modify: `src/client/client.ts`, `src/client/subscribe.ts`, `src/index.ts`
- Modify: `test/unit/client.test.ts`, `test/unit/subscribe.test.ts`
- Modify: `README.md`
- Test: `test/unit/client.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `abstract class BuildQLError extends Error`; `class BuildQLHttpError extends BuildQLError` (unchanged fields `status`, `body`); `class BuildQLResponseError extends BuildQLError` (renamed from `GraphQLResponseError`; unchanged fields `errors`, `data`). Tasks 8 and 11 throw these.

- [ ] **Step 1: Write the failing test**

Append to `test/unit/client.test.ts`:

```ts
import { BuildQLError, BuildQLHttpError, BuildQLResponseError } from '../../src/client/errors.js';

it('lets one instanceof check catch every buildql error', () => {
  expect(new BuildQLHttpError(500, 'boom')).toBeInstanceOf(BuildQLError);
  expect(new BuildQLResponseError([{ message: 'nope' }], undefined)).toBeInstanceOf(BuildQLError);
  expect(new BuildQLHttpError(500, 'boom').name).toBe('BuildQLHttpError');
  expect(new BuildQLResponseError([{ message: 'nope' }], undefined).name).toBe('BuildQLResponseError');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/client.test.ts`
Expected: FAIL — `BuildQLError` and `BuildQLResponseError` are not exported.

- [ ] **Step 3: Rewrite `errors.ts`**

`name` is assigned literally rather than from `new.target.name`, so the classes survive a minifying bundler.

```ts
export interface GraphQLFormattedError {
  readonly message: string;
  readonly path?: readonly (string | number)[];
  readonly locations?: readonly { line: number; column: number }[];
  readonly extensions?: Record<string, unknown>;
}

/**
 * Base class for every error buildql throws from the client. Exists so consumers can
 * write one `catch (e) { if (e instanceof BuildQLError) ... }` instead of enumerating
 * subclasses — and so adding a subclass later does not break that check.
 */
export abstract class BuildQLError extends Error {}

/** The server answered 2xx but the payload contained `errors`. */
export class BuildQLResponseError extends BuildQLError {
  readonly errors: readonly GraphQLFormattedError[];
  readonly data: unknown;

  constructor(errors: readonly GraphQLFormattedError[], data: unknown) {
    super(`buildql: ${errors.map((e) => e.message).join('; ') || 'GraphQL request failed'}`);
    // Assigned literally, not from `new.target.name`: a minifying bundler mangles
    // class names, and this string is part of the public contract.
    this.name = 'BuildQLResponseError';
    this.errors = errors;
    this.data = data;
  }
}

/** The transport failed — non-2xx status or an unparseable body. */
export class BuildQLHttpError extends BuildQLError {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`buildql: GraphQL request failed with HTTP ${status}`);
    this.name = 'BuildQLHttpError';
    this.status = status;
    this.body = body;
  }
}
```

- [ ] **Step 4: Update every reference**

```bash
grep -rln "GraphQLResponseError" src test README.md
```

Rename to `BuildQLResponseError` in each — `src/client/client.ts` (import plus two `throw` sites), `src/client/subscribe.ts` (import plus two sites), `src/index.ts`, and the tests.

In `src/index.ts`, line 3 becomes:

```ts
export { BuildQLError, BuildQLHttpError, BuildQLResponseError } from './client/errors.js';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/unit/client.test.ts test/unit/subscribe.test.ts`
Expected: PASS

- [ ] **Step 6: Verify and commit**

Run: `npm run check`
Expected: PASS

```bash
git add -A src test README.md
git commit -m "refactor(client): add BuildQLError base and rename GraphQLResponseError"
```

---

### Task 8: Split the client module

`src/client/client.ts` stutters in its path, defines `createClient`, *and* re-exports eight names that `src/index.ts` re-exports again — two hand-maintained copies of the same list, free to drift. Header merging is open-coded in three places.

The microtask subtlety documented at `client.ts:106-111` must survive: `subscribe` deliberately does not route through an `async` helper, because `await`-ing one defers a tick even when the value is already resolved, and `wsTransport` opens its socket synchronously in that same turn. The extraction below therefore shares only the *merge* loop; `subscribe` keeps its inline ternary and its comment.

**Files:**
- Create: `src/client/headers.ts`
- Create: `src/client/create-client.ts` (from `src/client/client.ts`)
- Create: `src/client/index.ts`
- Delete: `src/client/client.ts`
- Modify: `src/client/subscribe.ts:55-66`
- Modify: `src/index.ts`
- Modify: `package.json` (`exports["./client"]`, `typesVersions.client`)
- Modify: `tsup.config.ts`
- Modify: `test/unit/client.test.ts`, `test/unit/subscribe.test.ts`, `test/e2e/generate-and-run.test.ts`, `test/types/client.test-d.ts`

**Interfaces:**
- Consumes: Task 7's error classes
- Produces: `src/client/headers.ts` exporting `type HeadersSource = HeadersInit | (() => HeadersInit | Promise<HeadersInit>)`, `resolveHeaders(source: HeadersSource | undefined): Promise<HeadersInit>`, and `mergeHeaders(base: HeadersInit, override?: HeadersInit): Headers`. `src/client/index.ts` is the barrel for the `buildql/client` entry point.

- [ ] **Step 1: Write `src/client/headers.ts`**

```ts
/** Headers, or a function producing them — evaluated per request so tokens can refresh. */
export type HeadersSource = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);

/**
 * Resolves a `HeadersSource` to a plain `HeadersInit`.
 *
 * Callers on a path where an extra microtask is acceptable should use this. `subscribe`
 * in create-client.ts deliberately does NOT — see the comment there.
 */
export async function resolveHeaders(source: HeadersSource | undefined): Promise<HeadersInit> {
  if (!source) return {};
  return typeof source === 'function' ? await source() : source;
}

/**
 * Merges `override` onto `base`, last-writer-wins per header name. Per-request headers
 * beat client-level ones everywhere in buildql; this is the single place that rule lives.
 */
export function mergeHeaders(base: HeadersInit, override?: HeadersInit): Headers {
  const headers = new Headers(base);
  for (const [name, value] of new Headers(override ?? {})) headers.set(name, value);
  return headers;
}
```

- [ ] **Step 2: Create `src/client/create-client.ts`**

`git mv src/client/client.ts src/client/create-client.ts`, then: delete the four re-export lines (7–10), switch `ClientOptions.headers`/`SseTransportOptions.headers` to `HeadersSource`, delete the local `resolveHeaders`, and route the two header paths through the new helpers.

```ts
import type { Operation } from '../runtime/operation.js';
import type { HasVars } from '../types/vars.js';
import { BuildQLHttpError, BuildQLResponseError } from './errors.js';
import type { GraphQLFormattedError } from './errors.js';
import { mergeHeaders, resolveHeaders } from './headers.js';
import type { HeadersSource } from './headers.js';
import type { SubscriptionTransport } from './transport.js';

export interface ClientOptions {
  readonly url: string;
  readonly headers?: HeadersSource;
  readonly fetch?: typeof fetch;
  readonly subscriptions?: SubscriptionTransport;
}
```

In `execute`, replace the three header lines with:

```ts
      const headers = mergeHeaders(await resolveHeaders(options.headers), opts?.headers);
      headers.set('content-type', 'application/json');
      if (!headers.has('accept')) headers.set('accept', 'application/json');
```

In `subscribe`, keep the inline resolution and its comment, but use `mergeHeaders` for the merge:

```ts
          // Deliberately NOT routed through the shared `resolveHeaders` helper: calling
          // an `async function` always returns a Promise, and `await`-ing it — even when
          // the value is already resolved — always defers by a microtask. Some transports
          // (`wsTransport`) construct their connection synchronously as part of this same
          // turn, so an unconditional `await` here would delay that connection by a tick
          // for every subscription, not just ones with a headers function to resolve.
          const base =
            typeof options.headers === 'function' ? await options.headers() : (options.headers ?? {});
          const headers = mergeHeaders(base, opts?.headers);
```

Note the import of `SubscriptionTransport` now points at `./transport.js`, which Task 9 creates. Until then, keep it pointing at `./subscribe.js` and fix it in Task 9 — or do Task 9 first. **Do Task 9 first if executing out of order.**

- [ ] **Step 3: Create the barrel**

`src/client/index.ts` is now the single declaration of the `buildql/client` surface:

```ts
export { createClient } from './create-client.js';
export type { Client, ClientOptions, ExecuteOptions } from './create-client.js';
export { BuildQLError, BuildQLHttpError, BuildQLResponseError } from './errors.js';
export type { GraphQLFormattedError } from './errors.js';
export type { HeadersSource } from './headers.js';
export { sseTransport } from './sse-transport.js';
export type { SseTransportOptions } from './sse-transport.js';
export type { StreamChunk, SubscribePayload, SubscriptionTransport } from './transport.js';
export { wsTransport } from './ws-transport.js';
export type { WsTransportOptions } from './ws-transport.js';
```

(If Task 9 has not run yet, point the last four lines at `./subscribe.js` and correct them there.)

- [ ] **Step 4: Collapse `src/index.ts`'s duplicate list**

Replace lines 1–6 of `src/index.ts` with a single re-export of the barrel:

```ts
export {
  BuildQLError,
  BuildQLHttpError,
  BuildQLResponseError,
  createClient,
  sseTransport,
  wsTransport,
} from './client/index.js';
export type {
  Client,
  ClientOptions,
  ExecuteOptions,
  GraphQLFormattedError,
  HeadersSource,
  SseTransportOptions,
  StreamChunk,
  SubscribePayload,
  SubscriptionTransport,
  WsTransportOptions,
} from './client/index.js';
```

- [ ] **Step 5: Repoint the package entry point**

In `package.json`, `exports["./client"]` and `typesVersions["*"].client`:

```json
    "./client": {
      "types": "./dist/client/index.d.ts",
      "import": "./dist/client/index.js",
      "require": "./dist/client/index.cjs"
    },
```

```json
      "client": [
        "./dist/client/index.d.ts"
      ],
```

In `tsup.config.ts`, replace `'src/client/client.ts'` with `'src/client/index.ts'`.

- [ ] **Step 6: Update test imports**

```bash
grep -rln "client/client.js" test
```

Change each to `../../src/client/index.js` (adjusting depth per file).

- [ ] **Step 7: Verify and commit**

Run: `npm run check && npm run build`
Expected: PASS, and `dist/client/index.js` exists.

```bash
git add -A src test package.json tsup.config.ts
git commit -m "refactor(client): split create-client from the barrel, extract header helpers"
```

---

### Task 9: Split the subscription transports and extract an async queue

`src/client/subscribe.ts` is 205 lines carrying three responsibilities: the transport contract, an SSE implementation, and a WebSocket implementation. Inside it, `wsTransport.subscribe` is a ~95-line function juggling six mutable closure variables (`queue`, `done`, `completed`, `aborted`, `failure`, `wake`) that together are a hand-rolled push-driven async iterator. Four of those are queue mechanics and belong in a testable unit; two (`completed`, `aborted`) are graphql-ws protocol state and stay.

**Files:**
- Create: `src/client/transport.ts`
- Create: `src/client/async-queue.ts`
- Create: `src/client/sse-transport.ts`
- Create: `src/client/ws-transport.ts`
- Delete: `src/client/subscribe.ts`
- Modify: `src/client/create-client.ts`, `src/client/index.ts`
- Test: `test/unit/async-queue.test.ts` (create), `test/unit/subscribe.test.ts` (repoint imports)

**Interfaces:**
- Consumes: Task 7's errors, Task 8's `headers.ts`
- Produces: `src/client/transport.ts` exporting `SubscribePayload`, `StreamChunk`, `SubscriptionTransport`. `src/client/async-queue.ts` exporting `class AsyncQueue<T> implements AsyncIterable<T>` with `push(item: T): void`, `fail(error: Error): void`, `close(): void`. `sse-transport.ts` exports `sseTransport` + `SseTransportOptions`; `ws-transport.ts` exports `wsTransport` + `WsTransportOptions`.

- [ ] **Step 1: Write the failing test for the queue**

Create `test/unit/async-queue.test.ts`:

```ts
import { expect, it } from 'vitest';
import { AsyncQueue } from '../../src/client/async-queue.js';

async function drain<T>(q: AsyncQueue<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of q) out.push(item);
  return out;
}

it('yields items pushed before iteration starts', async () => {
  const q = new AsyncQueue<number>();
  q.push(1);
  q.push(2);
  q.close();
  expect(await drain(q)).toEqual([1, 2]);
});

it('yields items pushed while the consumer is waiting', async () => {
  const q = new AsyncQueue<number>();
  const drained = drain(q);
  q.push(1);
  await Promise.resolve();
  q.push(2);
  q.close();
  expect(await drained).toEqual([1, 2]);
});

it('drains everything already queued before surfacing a failure', async () => {
  const q = new AsyncQueue<number>();
  q.push(1);
  q.fail(new Error('boom'));
  const out: number[] = [];
  await expect(async () => {
    for await (const item of q) out.push(item);
  }).rejects.toThrow('boom');
  expect(out).toEqual([1]);
});

it('ends cleanly on close with no failure', async () => {
  const q = new AsyncQueue<number>();
  q.close();
  expect(await drain(q)).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/async-queue.test.ts`
Expected: FAIL — `src/client/async-queue.ts` does not exist.

- [ ] **Step 3: Write `src/client/async-queue.ts`**

```ts
/**
 * A single-consumer push queue exposed as an `AsyncIterable`.
 *
 * Event-driven transports (a `WebSocket`'s `onmessage`) produce values from callbacks
 * that cannot be awaited, while consumers want `for await`. This bridges the two: the
 * producer calls `push`/`fail`/`close`, the consumer iterates.
 *
 * Everything already queued is yielded BEFORE a recorded failure is thrown, so a server
 * that sends data and then errors does not lose the data.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private done = false;
  private failure: Error | null = null;
  private wake: (() => void) | null = null;

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  push(item: T): void {
    if (this.done) return;
    this.items.push(item);
    this.notify();
  }

  /** Records a terminal error and closes. The first failure wins; later ones are ignored. */
  fail(error: Error): void {
    if (this.done) return;
    this.failure = error;
    this.done = true;
    this.notify();
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    this.notify();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for (;;) {
      while (this.items.length > 0) yield this.items.shift()!;
      if (this.failure) throw this.failure;
      if (this.done) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}
```

- [ ] **Step 4: Run the queue tests to verify they pass**

Run: `npx vitest run test/unit/async-queue.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write `src/client/transport.ts`**

Lines 4–18 of the old `subscribe.ts`, verbatim:

```ts
import type { GraphQLFormattedError } from './errors.js';

export interface SubscribePayload {
  readonly query: string;
  readonly operationName: string;
  readonly variables: Record<string, unknown>;
}

export interface StreamChunk {
  readonly data?: unknown;
  readonly errors?: readonly GraphQLFormattedError[];
}

export interface SubscriptionTransport {
  /** `headers` carries per-subscription headers from `client.subscribe(op, vars, { headers })`. */
  subscribe(payload: SubscribePayload, signal: AbortSignal, headers?: HeadersInit): AsyncIterable<StreamChunk>;
}
```

- [ ] **Step 6: Write `src/client/sse-transport.ts`**

Lines 20–94 of the old `subscribe.ts`, with `SseTransportOptions.headers` switched to `HeadersSource` and the header block routed through the Task 8 helpers. Every existing comment carries over unchanged.

```ts
import { BuildQLHttpError } from './errors.js';
import { mergeHeaders, resolveHeaders } from './headers.js';
import type { HeadersSource } from './headers.js';
import type { StreamChunk, SubscriptionTransport } from './transport.js';

export interface SseTransportOptions {
  readonly url: string;
  readonly headers?: HeadersSource;
  readonly fetch?: typeof fetch;
}

/** Splits a byte stream into SSE events, buffering across chunk boundaries. */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // Normalize CRLF to LF: SSE permits `\r\n` line endings, and real servers emit
    // them. Doing this at decode time (rather than splitting on a regex) also fixes
    // the per-line `event:`/`data:` parsing below, which only checks for `\n`.
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      yield { event, data: dataLines.join('\n') };
      sep = buffer.indexOf('\n\n');
    }
  }
}

/** graphql-sse "distinct connections mode": one POST per subscription. */
export function sseTransport(opts: SseTransportOptions): SubscriptionTransport {
  const doFetch = opts.fetch ?? globalThis.fetch;
  return {
    async *subscribe(payload, signal, callHeaders) {
      // Per-subscription headers (from `client.subscribe(op, vars, { headers })`) override
      // the transport-level ones, mirroring how `execute`'s per-request headers win.
      const headers = mergeHeaders(await resolveHeaders(opts.headers), callHeaders);
      headers.set('content-type', 'application/json');
      headers.set('accept', 'text/event-stream');

      const res = await doFetch(opts.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
      });
      if (!res.ok || !res.body) {
        throw new BuildQLHttpError(res.status, await res.text().catch(() => ''));
      }
      let completed = false;
      for await (const evt of sseEvents(res.body)) {
        if (evt.event === 'complete') {
          completed = true;
          break;
        }
        if (evt.event !== 'next') continue;
        yield JSON.parse(evt.data) as StreamChunk;
      }
      // The stream ended (reader done, or a truncated trailing event was discarded)
      // without an explicit `complete` event. Treat that as an error rather than a
      // clean finish — otherwise a dropped connection is silently indistinguishable
      // from a subscription that legitimately has nothing more to send.
      if (!completed) {
        throw new Error('buildql: subscription stream ended before completing');
      }
    },
  };
}
```

- [ ] **Step 7: Write `src/client/ws-transport.ts`**

The protocol logic is unchanged — every comment on lines 106–189 of the old file carries over verbatim. The difference is that `queue`/`done`/`failure`/`wake` and the 12-line async iterator at the end are replaced by one `AsyncQueue`. `completed` and `aborted` stay: they are graphql-ws protocol state, not queue state.

```ts
import { AsyncQueue } from './async-queue.js';
import { BuildQLResponseError } from './errors.js';
import type { GraphQLFormattedError } from './errors.js';
import type { StreamChunk, SubscriptionTransport } from './transport.js';

export interface WsTransportOptions {
  readonly url: string;
  readonly connectionParams?:
    | Record<string, unknown>
    | (() => Record<string, unknown> | Promise<Record<string, unknown>>);
  readonly WebSocket?: typeof WebSocket;
}

/** graphql-ws protocol: connection_init -> subscribe -> next* -> complete. */
export function wsTransport(opts: WsTransportOptions): SubscriptionTransport {
  const WS = opts.WebSocket ?? globalThis.WebSocket;
  return {
    // The standard `WebSocket` constructor has no way to set custom HTTP headers, so
    // per-subscription headers (the third `subscribe` parameter) cannot be honored
    // here — authenticate via `connectionParams` instead, which travels in the
    // `connection_init` message body.
    subscribe(payload, signal) {
      const queue = new AsyncQueue<StreamChunk>();
      let completed = false;
      let aborted = false;

      const socket = new WS(opts.url, 'graphql-transport-ws');
      const id = '1';

      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- the async
      // body is deliberate; see the comment inside about routing throws to the queue.
      socket.onopen = async () => {
        try {
          const params =
            typeof opts.connectionParams === 'function' ? await opts.connectionParams() : opts.connectionParams;
          // The signal may have aborted, or the socket may already have closed, while
          // we were awaiting `connectionParams()` above — sending on a socket that
          // isn't open throws synchronously on a real `WebSocket`. Since nothing awaits
          // `onopen`, an uncaught throw here would become an unhandled rejection in the
          // consuming app; route it through the queue's failure path instead.
          if (socket.readyState !== WS.OPEN) return;
          socket.send(JSON.stringify({ type: 'connection_init', payload: params ?? {} }));
        } catch (err) {
          queue.fail(err instanceof Error ? err : new Error(String(err)));
        }
      };

      socket.onmessage = (evt: MessageEvent) => {
        const msg = JSON.parse(String(evt.data)) as { type: string; payload?: unknown };
        if (msg.type === 'connection_ack') {
          socket.send(JSON.stringify({ id, type: 'subscribe', payload }));
        } else if (msg.type === 'next' && msg.payload) {
          queue.push(msg.payload as StreamChunk);
        } else if (msg.type === 'error') {
          // graphql-ws defines `payload` on an `error` message as `GraphQLFormattedError[]`
          // — surface it via the same error type the `next`-with-`errors` path uses,
          // instead of discarding the server's diagnostics.
          const errors: readonly GraphQLFormattedError[] = Array.isArray(msg.payload) ? msg.payload : [];
          queue.fail(new BuildQLResponseError(errors, undefined));
        } else if (msg.type === 'complete') {
          completed = true;
          queue.close();
        }
      };

      socket.onerror = () => {
        queue.fail(new Error('buildql: subscription socket error'));
      };

      socket.onclose = () => {
        // An abnormal close (network drop, code 1006, ...) that never sent `complete`
        // is not a clean finish — without this it's silently indistinguishable from a
        // graceful shutdown. `AsyncQueue.fail` ignores a second call, so an
        // already-recorded failure wins; and we don't flag truncation if we're the
        // ones who closed it via `abort`.
        if (!completed && !aborted) {
          queue.fail(new Error('buildql: subscription stream ended before completing'));
        }
        queue.close();
      };

      signal.addEventListener('abort', () => {
        aborted = true;
        try {
          socket.send(JSON.stringify({ id, type: 'complete' }));
        } catch {
          /* socket already closed */
        }
        socket.close();
        queue.close();
      });

      return queue;
    },
  };
}
```

- [ ] **Step 8: Delete the old module and repoint imports**

```bash
git rm src/client/subscribe.ts
git mv test/unit/subscribe.test.ts test/unit/transports.test.ts
```

In `test/unit/transports.test.ts`, change the `subscribe.js` imports to `../../src/client/sse-transport.js` and `../../src/client/ws-transport.js`. Correct the four `./subscribe.js` / `./transport.js` import paths in `src/client/create-client.ts` and `src/client/index.ts` if Task 8 left them pointing at the old module.

- [ ] **Step 9: Run the transport tests**

Run: `npx vitest run test/unit/transports.test.ts test/unit/async-queue.test.ts`
Expected: PASS — all pre-existing subscription tests still green, including the abnormal-close, `onopen`-throws, and CRLF cases.

- [ ] **Step 10: Verify and commit**

Run: `npm run check`
Expected: PASS

```bash
git add -A src test
git commit -m "refactor(client): split sse/ws transports, extract AsyncQueue from wsTransport"
```

---

### Task 10: Dedupe the adapters

`toApolloQuery`, `toApolloMutation`, and `toUrqlArgs` each open-code the same two lines of variable defaulting. Both adapters also re-export `TypedDocumentNode` separately.

**Files:**
- Modify: `src/adapters/document.ts`
- Modify: `src/adapters/apollo.ts`, `src/adapters/urql.ts`
- Test: `test/unit/adapters.test.ts`

**Interfaces:**
- Consumes: Task 4's type names
- Produces: `src/adapters/document.ts` additionally exports `variablesOf<V>(rest: VarsArg<V>): V`.

- [ ] **Step 1: Add `variablesOf` to `document.ts`**

Append to `src/adapters/document.ts`:

```ts
import type { VarsArg } from '../types/vars.js';

/**
 * The variables from an adapter's trailing rest parameter, defaulting to `{}`.
 *
 * `VarsArg` makes the slot optional only when every variable is optional, so the
 * `{}` fallback is reachable exactly when it is correct.
 */
export function variablesOf<V>(rest: VarsArg<V>): V {
  const [vars] = rest as [V | undefined];
  return (vars ?? {}) as V;
}
```

- [ ] **Step 2: Use it in the Apollo adapter**

In `src/adapters/apollo.ts`:

```ts
import { assertKind, toDocument, variablesOf } from './document.js';
```

```ts
export function toApolloQuery<R, V>(op: Operation<R, V>, ...rest: VarsArg<V>): ApolloQueryArgs<R, V> {
  assertKind(op, ['query', 'subscription'], 'toApolloQuery');
  return { query: toDocument(op), variables: variablesOf(rest) };
}

/** `{ mutation, variables }` for `apolloClient.mutate()`. */
export function toApolloMutation<R, V>(op: Operation<R, V>, ...rest: VarsArg<V>): ApolloMutationArgs<R, V> {
  assertKind(op, ['mutation'], 'toApolloMutation');
  return { mutation: toDocument(op), variables: variablesOf(rest) };
}
```

- [ ] **Step 3: Use it in the urql adapter**

In `src/adapters/urql.ts`:

```ts
import { toDocument, variablesOf } from './document.js';
```

```ts
/**
 * `{ query, variables }` for `useQuery(...)` / `useSubscription(...)`.
 *
 * No `assertKind` here, unlike the Apollo adapter: urql uses the `query` key for every
 * operation kind, so there is no wrong kind to reject.
 */
export function toUrqlArgs<R, V>(op: Operation<R, V>, ...rest: VarsArg<V>): UrqlArgs<R, V> {
  return { query: toDocument(op), variables: variablesOf(rest) };
}
```

- [ ] **Step 4: Run the adapter tests**

Run: `npx vitest run test/unit/adapters.test.ts && npm run test:types`
Expected: PASS

- [ ] **Step 5: Verify and commit**

Run: `npm run check`
Expected: PASS

```bash
git add -A src
git commit -m "refactor(adapters): share variable defaulting via variablesOf"
```

---

### Task 11: Separate TypeScript type mapping from emission

`src/codegen/emit.ts` mixes two jobs: deciding what TypeScript type a GraphQL type maps to (`scalarTsType`, `leafTsType`, `inputTsType`, `argTsType`, `typenameTsType`, `unmappedScalars`) and assembling source text. The first is reused by field, input, and argument emission and is the part with the subtle rules.

**Files:**
- Create: `src/codegen/ts-types.ts`
- Modify: `src/codegen/emit.ts`
- Modify: `src/cli/index.ts:6` (the `unmappedScalars` import)
- Modify: `test/unit/emit.test.ts` (if it imports `unmappedScalars` directly)

**Interfaces:**
- Consumes: Task 6's builder names
- Produces: `src/codegen/ts-types.ts` exporting `leafTsType(ref, ir)`, `inputTsType(ref, ir)`, `argTsType(field, ir)`, `typenameTsType(t)`, `unmappedScalars(ir)`. `scalarTsType` stays module-private there.

- [ ] **Step 1: Create `src/codegen/ts-types.ts`**

Move lines 55–104 and 141–175 of `emit.ts` verbatim — every comment on `scalarTsType`, `inputTsType`, `typenameTsType`, and `unmappedScalars` is load-bearing and carries over unchanged.

```ts
import type { IRField, IRSchema, IRType, IRTypeRef } from './ir.js';
import { UNKNOWN_SCALAR } from './scalars.js';

/**
 * Looks up a scalar's mapped TS type by *own* property only. A plain `map[name]` (or
 * `name in map`) walks the prototype chain, so a schema scalar legitimately named
 * `toString`, `valueOf`, or `constructor` would resolve to the inherited
 * `Object.prototype` member instead of `undefined` — silently treating it as "mapped"
 * and splicing e.g. `Object.prototype.toString` into the generated source. `ir.scalars`
 * is also built with a null prototype (see `buildIR`) as defense in depth.
 */
function scalarTsType(ir: IRSchema, name: string): string | undefined {
  return Object.hasOwn(ir.scalars, name) ? ir.scalars[name] : undefined;
}

/** The TypeScript type a *leaf* (scalar/enum) named type maps to. */
export function leafTsType(ref: IRTypeRef, ir: IRSchema): string {
  if (ref.kind === 'enum') return ref.name;
  return scalarTsType(ir, ref.name) ?? UNKNOWN_SCALAR;
}

/** The TypeScript type of an *input* position, wrappers included. */
export function inputTsType(ref: IRTypeRef, ir: IRSchema): string {
  const base = ref.kind === 'input' || ref.kind === 'enum' ? ref.name : (scalarTsType(ir, ref.name) ?? UNKNOWN_SCALAR);
  // Walk the wrapper inner-to-outer, mirroring Apply<> from the runtime.
  let out = base;
  const toks = [...ref.wrap].reverse();
  let nonNull = false;
  for (const tok of toks) {
    if (tok === '!') {
      nonNull = true;
    } else {
      out = nonNull ? `${out}[]` : `(${out} | null)[]`;
      nonNull = false;
    }
  }
  return nonNull ? out : `${out} | null`;
}

/** The TS type of a field's argument object, e.g. `{ name: string; age?: number }`. */
export function argTsType(field: IRField, ir: IRSchema): string {
  const entries = field.args
    .map((a) => `${a.name}${a.optional ? '?' : ''}: ${inputTsType(a.type, ir)}`)
    .join('; ');
  return `{ ${entries} }`;
}

/**
 * The TS type of `__typename` for a type map. A union or interface can resolve to
 * one of several `possibleTypes` at runtime, so it must be typed as their union —
 * typing it as the abstract type's own name (e.g. `'Pet'`, a value the server never
 * actually sends) makes `__typename` collide with every `on()` branch's literal and
 * collapses the field to `never` wherever the two are intersected (see `Selected`
 * in `src/types/select.ts`). Concrete object types keep their own single literal name.
 */
export function typenameTsType(t: IRType): string {
  if (t.kind === 'union' || t.kind === 'interface') {
    if (t.possibleTypes.length === 0) return 'string';
    return t.possibleTypes.map((p) => `'${p}'`).join(' | ');
  }
  return `'${t.name}'`;
}

/**
 * Every custom scalar in the schema with no entry in `ir.scalars` — these fall back
 * to `UNKNOWN_SCALAR` (`unknown`) in the generated output, which silently drops all
 * type safety for that field (and, in argument position, all argument checking). The
 * CLI surfaces this list as a warning so the degradation is loud rather than silent.
 */
export function unmappedScalars(ir: IRSchema): string[] {
  const names = new Set<string>();
  for (const t of ir.types) {
    if (t.kind === 'scalar' && !Object.hasOwn(ir.scalars, t.name)) names.add(t.name);
  }
  return [...names].sort();
}
```

- [ ] **Step 2: Trim `emit.ts` down to emission**

Delete the moved functions and add the import:

```ts
import type { IRArg, IRField, IRSchema, IRType } from './ir.js';
import { CLIENT_EMITS } from './clients.js';
import type { ClientKind } from './clients.js';
import { argTsType, inputTsType, leafTsType, typenameTsType } from './ts-types.js';
```

`emit.ts` no longer imports `UNKNOWN_SCALAR` or `IRTypeRef`; remove both. Do **not** re-export the moved functions from `emit.ts` — one home each is the point of the split.

- [ ] **Step 3: Repoint the two importers**

In `src/cli/index.ts`, split line 6:

```ts
import { emit } from '../codegen/emit.js';
import { unmappedScalars } from '../codegen/ts-types.js';
```

In `test/unit/emit.test.ts`, line 5 imports `unmappedScalars` from `emit.js` as well — split it the same way:

```ts
import { emit } from '../../src/codegen/emit.js';
import { unmappedScalars } from '../../src/codegen/ts-types.js';
```

- [ ] **Step 4: Verify and commit**

Run: `npm run check`
Expected: PASS

```bash
git add -A src test
git commit -m "refactor(codegen): split TypeScript type mapping out of the emitter"
```

---

### Task 12: Split the CLI and inject a reporter

`src/cli/index.ts` does five things: resolves paths and runs the codegen pipeline, writes progress to `process.stdout`/`process.stderr`, parses argv, decides whether it is the process entrypoint, and — at module scope — invokes itself. The console coupling is why `test/unit/cli.test.ts` installs global `process.stdout.write` spies in `beforeEach` just to keep test output clean.

`isEntrypoint` exists **only** because `generate`/`main` share a file with the module-scope invocation. Once the invocation lives alone in `bin.ts`, which nothing imports, the guard has no condition left to get wrong and is deleted along with its five tests. Its real guarantee — that the installed binary actually runs — moves to a CI smoke check against the built artifact, which is stronger than a unit test of the predicate.

**Files:**
- Create: `src/cli/reporter.ts`
- Create: `src/cli/generate.ts`
- Create: `src/cli/main.ts`
- Create: `src/cli/bin.ts`
- Delete: `src/cli/index.ts`
- Modify: `package.json` (`bin`, `sideEffects`)
- Modify: `tsup.config.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `test/unit/cli.test.ts`, `test/e2e/generate-and-run.test.ts`

**Interfaces:**
- Consumes: Task 11's `unmappedScalars`
- Produces: `src/cli/reporter.ts` exporting `interface Reporter { info(message: string): void; warn(message: string): void }`, `consoleReporter: Reporter`, and `collectingReporter(): Reporter & { infos: string[]; warns: string[] }`. `src/cli/generate.ts` exports `generate(config: BuildQLConfig, cwd: string, reporter?: Reporter): Promise<string>`. `src/cli/main.ts` exports `main(argv: string[]): Promise<number>`.

- [ ] **Step 1: Write the failing test**

Replace the five `isEntrypoint` tests at the bottom of `test/unit/cli.test.ts` with this, and change the import on line 6 to `import { generate } from '../../src/cli/generate.js';` plus `import { main } from '../../src/cli/main.js';` and `import { collectingReporter } from '../../src/cli/reporter.js';`:

```ts
it('reports unmapped scalars through the injected reporter, not the console', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-'));
  await copyFile(sdlPath, join(dir, 'schema.graphql'));
  const reporter = collectingReporter();

  await generate({ schema: './schema.graphql', output: '.' }, dir, reporter);

  expect(reporter.warns.join('\n')).toContain('unmapped custom scalar');
  expect(written(stderrSpy)).toBe('');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/unit/cli.test.ts`
Expected: FAIL — `src/cli/generate.ts` and `src/cli/reporter.ts` do not exist.

- [ ] **Step 3: Write `src/cli/reporter.ts`**

```ts
/**
 * Where the CLI's progress and warning output goes.
 *
 * A port, so `generate` does not reach for `process.stdout`/`process.stderr` directly:
 * that made it impossible to assert on its diagnostics without spying on globals, and
 * impossible to embed the pipeline in anything that is not a terminal.
 */
export interface Reporter {
  /** Progress: which config was used, what was written. */
  info(message: string): void;
  /** Something degraded but did not fail — e.g. a scalar generated as `unknown`. */
  warn(message: string): void;
}

/** The binary's reporter: `info` to stdout, `warn` to stderr, one line each. */
export const consoleReporter: Reporter = {
  info(message) {
    process.stdout.write(`${message}\n`);
  },
  warn(message) {
    process.stderr.write(`${message}\n`);
  },
};

/** An in-memory reporter for tests. */
export function collectingReporter(): Reporter & { readonly infos: string[]; readonly warns: string[] } {
  const infos: string[] = [];
  const warns: string[] = [];
  return {
    infos,
    warns,
    info: (message) => infos.push(message),
    warn: (message) => warns.push(message),
  };
}
```

- [ ] **Step 4: Write `src/cli/generate.ts`**

Lines 1–48 of the old `index.ts`, with the two `process.std*` writes routed through the reporter and the nested ternary flattened into a named helper.

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { CLIENT_EMITS } from '../codegen/clients.js';
import { emit } from '../codegen/emit.js';
import { buildIR } from '../codegen/ir.js';
import { loadSchema } from '../codegen/introspect.js';
import { unmappedScalars } from '../codegen/ts-types.js';
import { resolveOutputDir } from './config.js';
import type { BuildQLConfig } from './config.js';
import { consoleReporter } from './reporter.js';
import type { Reporter } from './reporter.js';

/** A URL is passed through untouched; a relative path resolves against `cwd`. */
function resolveSchemaSource(schema: string, cwd: string): string {
  if (/^https?:\/\//.test(schema)) return schema;
  return isAbsolute(schema) ? schema : resolve(cwd, schema);
}

/** Runs the full pipeline and returns the path of the file written. */
export async function generate(
  config: BuildQLConfig,
  cwd: string,
  reporter: Reporter = consoleReporter,
): Promise<string> {
  const schema = await loadSchema(resolveSchemaSource(config.schema, cwd), { headers: config.headers });
  const ir = buildIR(schema, config.scalars);

  const unmapped = unmappedScalars(ir);
  if (unmapped.length > 0) {
    reporter.warn(
      `buildql: unmapped custom scalar${unmapped.length > 1 ? 's' : ''}: ${unmapped.join(', ')} — ` +
        `generated as \`unknown\`. Add ${unmapped.length > 1 ? 'them' : 'it'} to "scalars" in your buildql.config.* for real types.`,
    );
  }

  const client = config.client ?? 'buildql';
  const { module, names } = CLIENT_EMITS[client];
  if (module && module !== 'buildql') {
    reporter.info(
      `buildql: client "${client}" — the generated module re-exports ${names.join(', ')} ` +
        `from ${module} (requires the "graphql" package)`,
    );
  }

  const src = emit(ir, client);

  const dir = resolveOutputDir(config, cwd);
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'index.ts');
  await writeFile(file, src, 'utf8');
  return file;
}
```

- [ ] **Step 5: Write `src/cli/main.ts`**

Lines 50–82 of the old `index.ts`, with the reporter threaded through.

```ts
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { generate } from './generate.js';
import { consoleReporter } from './reporter.js';
import type { Reporter } from './reporter.js';

const USAGE = `buildql — type-safe GraphQL query builder codegen

Usage:
  buildql generate [--config <dir>]   Generate the SDK from buildql.config.*
  buildql --help                      Show this message
`;

/** Parses argv, runs the requested command, and returns the process exit code. */
export async function main(argv: string[], reporter: Reporter = consoleReporter): Promise<number> {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(USAGE);
    return cmd ? 0 : 1;
  }
  if (cmd !== 'generate') {
    process.stderr.write(`buildql: unknown command "${cmd}"\n\n${USAGE}`);
    return 1;
  }

  const flagIndex = argv.indexOf('--config');
  const cwd = flagIndex !== -1 && argv[flagIndex + 1] ? resolve(argv[flagIndex + 1]!) : process.cwd();

  try {
    const { config, path } = await loadConfig(cwd);
    reporter.info(`buildql: using ${path}`);
    const out = await generate(config, cwd, reporter);
    reporter.info(`buildql: wrote ${out}`);
    return 0;
  } catch (err) {
    reporter.warn(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
```

Both `USAGE` branches keep writing to `process.stdout`/`process.stderr` directly: help text and the unknown-command message are the binary's own interface, not pipeline diagnostics, and they must reach the terminal even when a caller supplies a silent reporter.

- [ ] **Step 6: Write `src/cli/bin.ts`**

The whole file. Nothing imports it, so no entrypoint guard is needed.

```ts
#!/usr/bin/env node
// The installed binary, and nothing else. `main` lives in main.ts so tests can import it
// without executing it — which is why this file needs no `isEntrypoint` guard.
import { main } from './main.js';

// NOT top-level `await`: tsup emits this entry as both ESM and CJS, and top-level await
// has no CJS equivalent, so it would fail the `require` build.
void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
```

Then remove the old module:

```bash
git rm src/cli/index.ts
```

- [ ] **Step 7: Repoint the package binary and declare the side effect**

In `package.json`:

```json
  "bin": {
    "buildql": "./dist/cli/bin.js"
  },
```

and replace `"sideEffects": false` — which is now false in the literal sense, since `bin.js` runs `main()` on import — with an explicit exception:

```json
  "sideEffects": [
    "./dist/cli/bin.js",
    "./dist/cli/bin.cjs"
  ],
```

In `tsup.config.ts`, replace `'src/cli/index.ts'` with `'src/cli/bin.ts'` and add `'src/cli/generate.ts'` so `generate` stays importable:

```ts
  entry: [
    'src/index.ts',
    'src/client/index.ts',
    'src/cli/config.ts',
    'src/cli/generate.ts',
    'src/cli/bin.ts',
    'src/adapters/apollo.ts',
    'src/adapters/urql.ts',
  ],
```

- [ ] **Step 8: Repoint the e2e test**

In `test/e2e/generate-and-run.test.ts`, line 8:

```ts
import { generate } from '../../src/cli/generate.js';
```

- [ ] **Step 9: Add the binary smoke check to CI**

This replaces what the deleted `isEntrypoint` tests were protecting, and does it against the real built artifact. Append to the `check` job in `.github/workflows/ci.yml`, after `- run: npm run build`:

```yaml
      - name: The built binary actually runs
        run: node dist/cli/bin.js --help | grep -q 'type-safe GraphQL query builder codegen'
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run test/unit/cli.test.ts test/e2e/generate-and-run.test.ts`
Expected: PASS, including the new reporter test.

Then confirm the CI check locally:

```bash
npm run build && node dist/cli/bin.js --help
```

Expected: the usage text.

- [ ] **Step 11: Verify and commit**

Run: `npm run check`
Expected: PASS

```bash
git add -A src test package.json tsup.config.ts .github/workflows/ci.yml
git commit -m "refactor(cli): split generate/main/bin and inject a reporter port"
```

---

### Task 13: Lock the public surface

Two loose ends remain. `VERSION = '0.1.0'` in `src/index.ts` duplicates `package.json`'s version with nothing keeping them in sync, and `test/unit/smoke.test.ts` asserts the literal `'0.1.0'` — so the next version bump silently makes the export wrong and the test still passes. And nothing catches an accidental addition or removal from the package's public API.

**Files:**
- Modify: `src/index.ts`
- Delete: `test/unit/smoke.test.ts`
- Create: `test/unit/public-api.test.ts`
- Modify: `README.md`
- Create: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: every prior task's renames
- Produces: nothing further depends on this.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/public-api.test.ts`:

```ts
import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as api from '../../src/index.js';

it('exports exactly the documented public surface', () => {
  // A deliberate tripwire, not a rubber stamp: adding or removing a runtime export is a
  // public API change, so it should require editing this list in the same commit.
  expect(Object.keys(api).sort()).toEqual([
    'BuildQLError',
    'BuildQLHttpError',
    'BuildQLResponseError',
    'VERSION',
    '$',
    'argSpec',
    'createClient',
    'include',
    'leafField',
    'leafFieldArgs',
    'makeFragment',
    'makeMutation',
    'makeQuery',
    'makeSubscription',
    'objectField',
    'objectFieldArgs',
    'on',
    'skip',
    'spread',
    'sseTransport',
    'v',
    'wsTransport',
  ].sort());
});

it('keeps VERSION in step with package.json', async () => {
  const pkg = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  expect(api.VERSION).toBe(pkg.version);
});
```

- [ ] **Step 2: Run them to verify they pass (or tell you what drifted)**

Run: `npx vitest run test/unit/public-api.test.ts`
Expected: PASS. If the first test fails, the actual export list is the source of truth — reconcile the array against it and confirm each difference is intended.

- [ ] **Step 3: Replace the smoke test**

The version assertion now lives in `public-api.test.ts` and compares against `package.json` rather than a literal.

```bash
git rm test/unit/smoke.test.ts
```

Add a note above the `VERSION` export in `src/index.ts`:

```ts
/** Kept in step with package.json by `test/unit/public-api.test.ts`. */
export const VERSION = '0.1.0';
```

- [ ] **Step 4: Write down the conventions**

Create `CONTRIBUTING.md`:

```markdown
# Contributing

Run `npm run check` before every commit. It runs, in order: ESLint, Prettier,
`tsc`, Vitest, and the type-instantiation budget.

## Conventions

**Files** are kebab-case, one responsibility each — enforced by `unicorn/filename-case`.
A file that grows past ~200 lines or acquires a second reason to change gets split.

**Function prefixes** carry meaning:

| Prefix | Meaning | Example |
|---|---|---|
| `make*` | returns a builder function | `makeQuery`, `makeFragment` |
| `to*` | pure conversion | `toDocument`, `toApolloQuery` |
| `is*` | type-guard predicate | `isVarMarker`, `isClientKind` |
| `assert*` | throws, or narrows its argument | `assertKind`, `assertBuildQLConfig` |
| `collect*` | walks a tree accumulating results | `collectFragments` |
| `print*` | renders to GraphQL source text | `printOperation`, `printValue` |
| `emit*` | renders to TypeScript source text | `emitField`, `emitTypeMap` |

**Types** are PascalCase and spell out the concept. Avoid abbreviations that only make
sense from inside the file — `FieldSelection`, not `Sel`.

**Errors** all extend `BuildQLError`, and every message starts with `buildql: `.

**Casts.** `any` is banned. `unknown` plus a documented cast is the house style — every
`as unknown as` must say what type parameter it is attaching and why the value cannot
carry it structurally.

**Type-checker performance is a budget, not a preference.** `npm run test:perf` caps
`test/perf/generated.ts` at 25,000 instantiations and 3 seconds. Generic indirection in
`src/types/**` and `src/runtime/builders.ts` is measured before it is added — which is
why the four `Object.assign(make(undefined), { as })` blocks in `builders.ts` stay
duplicated rather than being hoisted behind a helper.
```

- [ ] **Step 5: Update the README's API names**

```bash
grep -n "GraphQLResponseError\|\bleaf\b\|\bobject(\|FragmentHandle\|FragmentDef\|client/client" README.md
```

Update each hit to the Task 4/6/7 names. Add a line to the `## Install` or `## Requirements` section pointing at the new file:

```markdown
Contributing? See [CONTRIBUTING.md](./CONTRIBUTING.md) for the naming and
type-performance conventions the linter enforces.
```

- [ ] **Step 6: Verify and commit**

Run: `npm run check && npm run build`
Expected: PASS

```bash
git add -A src test README.md CONTRIBUTING.md
git commit -m "test: pin the public API surface and document conventions"
```

---

## Execution Notes

**Task order matters in two places:**
- Task 9 (transport split) creates `src/client/transport.ts`, which Task 8 imports. Run 8 → 9 in order and fix the two import paths as Step 8 of Task 9 says, or run 9 before 8.
- Task 11 moves `unmappedScalars`, which Task 12's `generate.ts` imports. Run 11 before 12.

Everything else is independent.

**Deliberately not done, with reasons** — so a later reviewer does not "fix" them:
- The four `Object.assign(make(undefined), { as })` blocks in `builders.ts` stay duplicated. Hoisting them behind a generic helper costs type-checker instantiations against a hard 25,000 budget (Task 6).
- `noUncheckedIndexedAccess` stays off. Enabling it requires either weakening `Arg<T>` to accept `undefined` for required arguments, or replacing `$.name` with `$('name')` — public API decisions, not cleanups (Task 3).
- `src/types/util.ts` keeps its generic name. Its four members genuinely are general-purpose type utilities, and a longer name would not say more.
- `Client.options` stays on the interface. It is unused internally, but reading back the configured URL is a reasonable thing for a consumer to want.
