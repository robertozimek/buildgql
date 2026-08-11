# Contributing

Run `npm run check` before every commit. It runs, in order: ESLint, Prettier,
`tsc`, the build, Vitest, and the type-instantiation budget. The build sits between
`tsc` and Vitest — not merely alongside them — because `test/built/**` asserts on
`dist/` output rather than on `src/`, and needs it to exist first.

## Conventions

**Files** are kebab-case, one responsibility each — enforced by `unicorn/filename-case`.
A file that grows past ~200 lines or acquires a second reason to change gets split.

**Function prefixes** carry meaning:

| Prefix     | Meaning                           | Example                              |
| ---------- | --------------------------------- | ------------------------------------ |
| `make*`    | returns a builder function        | `makeQuery`, `makeFragment`          |
| `to*`      | pure conversion                   | `toDocument`, `toApolloQuery`        |
| `is*`      | type-guard predicate              | `isVarMarker`, `isClientKind`        |
| `assert*`  | throws, or narrows its argument   | `assertKind`, `assertBuildGQLConfig` |
| `collect*` | walks a tree accumulating results | `collectFragments`                   |
| `print*`   | renders to GraphQL source text    | `printOperation`, `printValue`       |
| `emit*`    | renders to TypeScript source text | `emitField`, `emitTypeMap`           |

**Types** are PascalCase and spell out the concept. Avoid abbreviations that only make
sense from inside the file — `FieldSelection`, not `Sel`.

**Errors.** Every thrown message starts with `buildgql: `. Most call sites throw a plain
`Error` with that prefix; the client's typed errors (`BuildGQLHttpError`,
`BuildGQLResponseError`) extend the exported `BuildGQLError` base so consumers can catch
them with one `instanceof`. Adding a new error _class_ means extending `BuildGQLError`;
a one-off `throw new Error('buildgql: ...')` elsewhere in `src/` is fine as is.

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
and `src/types/**` must work for consumers who never install it. Where the CLI resolves it
_from_ is part of that contract: `importGraphql` in `src/codegen/introspect.ts` falls back
to the user's project directory because under `npx`/`pnpm dlx` the binary runs out of a
cache directory that has no `graphql` above it. `test/built/npx.test.ts` reproduces that
layout — anything that changes how the CLI reaches `graphql` has to keep it passing.

**Public surface.** `src/index.ts`'s runtime (value) exports are pinned by
`test/unit/public-api.test.ts`; its full export surface, values and type-only alike, is
separately pinned by `test/built/type-surface.test.ts` against the built
`dist/index.d.ts` — a type-only export has no runtime binding, so the first list can't
see it either added or removed. Adding or removing any export from `src/index.ts` means
updating whichever list(s) actually see it in the same commit. Built-output invariants
that aren't about the export surface itself (what `bin`/`exports`/`typesVersions`
resolve to, cross-entry error identity, the CLI shebang) live in
`test/built/interop.test.ts` instead, since those depend on `tsup.config.ts` and
`package.json` rather than on `src/`.

## Releasing

Publishing is done by `.github/workflows/release.yml`, triggered by a version tag — never
by hand, so that every published tarball is built by CI from a known commit and carries an
npm provenance attestation.

The workflow authenticates with
[trusted publishing](https://docs.npmjs.com/trusted-publishers): npm exchanges the
workflow's OIDC token for a short-lived, package-scoped credential. **This repository holds
no npm token, and should not be given one.** A CI token is a long-lived credential that
bypasses the account's 2FA — npm itself now warns about that when you create one — and it
is exactly what trusted publishing exists to remove.

### One-time setup

OIDC cannot publish a package that does not yet exist: npmjs.com only exposes trusted
publisher settings on an existing package ([npm/cli#8544](https://github.com/npm/cli/issues/8544)).
So the very first version is published by hand, and every version after it by the workflow.

1. `npm login`, then `npm publish` from a clean checkout of the tagged commit. This prompts
   for a 2FA one-time password; no token is created at any point. (This one release has no
   provenance attestation — nothing published from a laptop can have one.)
2. On npmjs.com: **buildgql → Settings → Trusted publisher →** GitHub Actions, repository
   `robertozimek/buildgql`, workflow filename `release.yml`, environment `production`. The
   filename must match exactly; renaming the workflow breaks publishing until this is
   updated. Naming the environment means npm rejects an OIDC token minted by a job that did
   not enter `production`, so the environment's protection rules cannot be sidestepped by
   adding a second workflow.
3. Same page, **Publishing access → Require two-factor authentication or trusted publishing**.
   That is what actually forbids a token from publishing, rather than merely not having one.
4. In the repository, **Settings → Environments → production → Deployment branches and tags**:
   allow **both** the `main` branch and the `v*` **tag** pattern. Both are needed because a
   release can be triggered by either event — see below. Anything else that belongs on a
   release (required reviewers, a wait timer) goes here too.

"Released only from main" is deliberately _not_ one of those rules. A tag ref carries no
branch to match against, so no ref pattern can express it; the `gate` job proves it directly
by requiring the tagged commit to be an ancestor of `main`. That job sits outside the
environment on purpose — every push to `main` reaches this workflow, and an environment with
required reviewers would turn each of those into a pending deployment awaiting approval.

### Cutting a release

A release needs two things to be true — a `v*` tag exists, and the commit it points at is on
`main` — and they may become true in either order. Both events trigger the workflow, and each
run asks the same question, so either order works:

```bash
# From main: the tag push publishes immediately.
npm version patch   # or minor / major — writes package.json and creates the v* tag
git push --follow-tags
```

```bash
# From a version-bump branch: the tag push does nothing (a notice, a green run), and the
# push to main that merges the PR publishes.
npm version minor && git push --follow-tags && gh pr create
```

Tagging an unmerged commit is therefore not an error and does not fail a run. The only hard
failure in the gate is a tag that disagrees with `package.json`: npm derives the published
version from the manifest and ignores the tag, so that combination would publish a version
nobody asked for under a tag pointing at different code — and a version can never be
republished. A run also ends quietly when the version is already on npm, which every later
push to `main` would otherwise hit.

Merge with a merge commit rather than a squash for a version-bump PR. A squash rewrites the
commit, so the tag is left pointing at one that never reaches `main` and the release waits
forever. If that happens, move the tag onto the squashed commit and push it again.

Once it publishes, the job runs the full `npm run check` gate first — on Node 22, since
trusted publishing needs Node >= 22.14 and npm >= 11.5.1 (Node 22 ships npm 10.9, so the
workflow upgrades npm itself). `engines` still declares Node >= 18 for consumers, and
`ci.yml` still checks on 20. `prepack` rebuilds `dist/` as part of `npm publish`, so the
tarball never depends on whatever happened to be in a working tree — `dist/` is gitignored
and `files` ships nothing else.

Verify a release candidate locally with `npm pack` and run the tarball the way a user
would (`npx ./buildgql-<version>.tgz generate` in a scratch project); `test/built/**` covers
the same ground automatically on every run of `npm run check`.
