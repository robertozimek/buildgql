# Contributing

Run `npm run check` before every commit. It runs, in order: ESLint, Prettier,
`tsc`, the build, Vitest, and the type-instantiation budget. The build sits between
`tsc` and Vitest — not merely alongside them — because `test/built/**` asserts on
`dist/` output rather than on `src/`, and needs it to exist first.

## Conventions

**Files** are kebab-case, one responsibility each — enforced by `unicorn/filename-case`.
A file that grows past ~200 lines or acquires a second reason to change gets split.

**Function prefixes** carry meaning:

| Prefix     | Meaning                           | Example                             |
| ---------- | --------------------------------- | ----------------------------------- |
| `make*`    | returns a builder function        | `makeQuery`, `makeFragment`         |
| `to*`      | pure conversion                   | `toDocument`, `toApolloQuery`       |
| `is*`      | type-guard predicate              | `isVarMarker`, `isClientKind`       |
| `assert*`  | throws, or narrows its argument   | `assertKind`, `assertBuildQLConfig` |
| `collect*` | walks a tree accumulating results | `collectFragments`                  |
| `print*`   | renders to GraphQL source text    | `printOperation`, `printValue`      |
| `emit*`    | renders to TypeScript source text | `emitField`, `emitTypeMap`          |

**Types** are PascalCase and spell out the concept. Avoid abbreviations that only make
sense from inside the file — `FieldSelection`, not `Sel`.

**Errors.** Every thrown message starts with `buildql: `. Most call sites throw a plain
`Error` with that prefix; the client's typed errors (`BuildQLHttpError`,
`BuildQLResponseError`) extend the exported `BuildQLError` base so consumers can catch
them with one `instanceof`. Adding a new error _class_ means extending `BuildQLError`;
a one-off `throw new Error('buildql: ...')` elsewhere in `src/` is fine as is.

**Casts.** `any` is banned. `unknown` plus a documented cast is the house style — every
`as unknown as` must say what type parameter it is attaching and why the value cannot
carry it structurally.

**Type-checker performance is a budget, not a preference.** `npm run test:perf` caps
`test/perf/generated.ts` at 25,000 instantiations and 3 seconds. Generic indirection in
`src/types/**` and `src/runtime/builders.ts` is measured before it is added — which is
why the four `Object.assign(make(undefined), { as })` blocks in `builders.ts` stay
duplicated rather than being hoisted behind a helper.

**`graphql` stays optional.** It is an optional peer dependency, imported only from
`src/adapters/**` and `src/codegen/**`. `src/index.ts`, `src/client/**`, `src/runtime/**`
and `src/types/**` must work for consumers who never install it.

**Public surface.** `src/index.ts`'s runtime exports are pinned by
`test/unit/public-api.test.ts` — adding or removing one means updating that list in the
same commit. Built-output invariants (what `bin`/`exports`/`typesVersions` resolve to,
cross-entry error identity, the CLI shebang) live in `test/built/interop.test.ts`
instead, since those depend on `tsup.config.ts` and `package.json` rather than on
`src/`.
