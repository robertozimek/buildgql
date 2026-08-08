# Complex Scalar Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `scalars` in `buildql.config.*` map a GraphQL scalar to a real object-shaped TypeScript type — imported from a module, declared inline, and/or typed differently in argument vs result position — instead of only a raw inline type expression.

**Architecture:** `scalars` grows from `Record<string, string>` to `Record<string, string | ScalarTypeConfig>`. A new `resolveScalars()` in `src/codegen/scalars.ts` normalises every entry into a `ScalarMapping` (`{ input, output }`) plus a _prelude_ — the `import type` lines and `export type` aliases the generated module must carry. The IR carries both; `ts-types.ts` picks `.input` or `.output` by position; `emit.ts` renders the prelude between the runtime import and the generated types. Module specifiers are rewritten by `src/codegen/scalar-imports.ts` so a relative `from` written against the config file lands correctly relative to `output`, while bare specifiers pass through untouched.

**Tech Stack:** TypeScript 5.9, Node >= 18, Vitest 2, ESLint 9 + Prettier, tsup. No new dependencies.

---

## Why the import path rule is what it is

The generated module gets consumed in two very different ways, and the rule has to serve both:

| Scenario                                                          | What the user writes                                      | What gets emitted                                                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Generated inside the frontend app, types live in the same repo    | `from: './src/types/money'` (relative to the config file) | `import type { Money } from '../types/money';` — buildql recomputes it against `output`                                        |
| Generated in the backend repo and **published as an npm package** | `from: '@myorg/domain-types'` or `from: 'type-fest'`      | `import type { Money } from '@myorg/domain-types';` — verbatim; the specifier still resolves from inside the published package |
| Published package with **no external type dependency at all**     | `declare: '{ amount: number; currency: string }'`         | `export type Money = { amount: number; currency: string };` — inlined into the generated module, nothing to resolve            |

**The rule:** a specifier that starts with `.` or is absolute is a _file path_, so it is resolved against the config file's directory and re-expressed relative to the output directory. Anything else is a _package specifier_ and is emitted byte-for-byte. Extensions are preserved exactly as written (`'./types/money.js'` stays `.js`), so `nodenext` projects keep working.

Relative specifiers resolve against the config file's directory because that is where `schema` and `output` already resolve from — one mental model for every path in the config — and because it means changing `output` cannot silently break an import.

All imports are emitted as `import type`, so the generated module never carries a runtime dependency on the user's type module.

---

## Global Constraints

- Every thrown message starts with `buildql: ` — plain `Error` is fine in `src/`; new error _classes_ would have to extend `BuildQLError` (none are added here).
- `any` is banned. `unknown` plus a documented cast is the house style.
- Files are kebab-case, one responsibility each. A file past ~200 lines gets split.
- Function prefixes carry meaning: `is*` type-guard, `assert*` throws or narrows, `emit*` renders TypeScript source, `to*` pure conversion.
- `graphql` is an optional peer dependency, imported only from `src/adapters/**` and `src/codegen/**`. None of the files in this plan import it.
- `npm run check` (lint → format:check → test:types → build → test → test:perf) must pass before every commit.
- Default output must stay **byte-identical** for configs that use only the existing string form. The prelude block is emitted only when non-empty.
- Node >= 18, TypeScript >= 5.4 (peer floor). No new runtime or dev dependencies.

---

### Task 1: Scalar config model and `resolveScalars`

Defines the public config shape and the single function that turns raw config entries into (a) a per-scalar `{ input, output }` mapping and (b) the prelude the emitter needs. This is pure data — no filesystem, no paths.

**Files:**

- Modify: `src/codegen/scalars.ts` (currently 11 lines — grows to ~120)
- Test: `test/unit/scalars.test.ts` (create)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `type ScalarConfig = string | ScalarTypeConfig`
  - `interface ScalarTypeConfig { name?: string; from?: string; declare?: string; input?: string; output?: string }`
  - `interface ScalarMapping { input: string; output: string }`
  - `interface ScalarImport { name: string; from: string }`
  - `interface ScalarDeclaration { name: string; body: string }`
  - `interface ScalarPrelude { imports: readonly ScalarImport[]; declarations: readonly ScalarDeclaration[] }`
  - `interface ResolvedScalars { scalars: Record<string, ScalarMapping>; prelude: ScalarPrelude }`
  - `type SpecifierRewriter = (from: string) => string`
  - `const EMPTY_SCALAR_PRELUDE: ScalarPrelude`
  - `const DEFAULT_SCALAR_MAPPINGS: Readonly<Record<string, ScalarMapping>>`
  - `function resolveScalars(overrides?: Readonly<Record<string, ScalarConfig>>, rewriteFrom?: SpecifierRewriter): ResolvedScalars`
  - `DEFAULT_SCALARS` and `UNKNOWN_SCALAR` keep their current exported shape.

---

- [ ] **Step 1: Write the failing test**

Create `test/unit/scalars.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveScalars } from '../../src/codegen/scalars.js';

describe('resolveScalars', () => {
  it('keeps the five built-ins when nothing is overridden', () => {
    const { scalars, prelude } = resolveScalars();
    expect(scalars.ID).toEqual({ input: 'string', output: 'string' });
    expect(scalars.Boolean).toEqual({ input: 'boolean', output: 'boolean' });
    expect(prelude).toEqual({ imports: [], declarations: [] });
  });

  it('treats a plain string as the same type in both positions', () => {
    const { scalars } = resolveScalars({ DateTime: 'string' });
    expect(scalars.DateTime).toEqual({ input: 'string', output: 'string' });
  });

  it('splits input and output when both are given', () => {
    const { scalars } = resolveScalars({ DateTime: { input: 'string | Date', output: 'string' } });
    expect(scalars.DateTime).toEqual({ input: 'string | Date', output: 'string' });
  });

  it('fills the missing half from the one that was given', () => {
    expect(resolveScalars({ A: { output: 'Date' } }).scalars.A).toEqual({ input: 'Date', output: 'Date' });
    expect(resolveScalars({ B: { input: 'Date' } }).scalars.B).toEqual({ input: 'Date', output: 'Date' });
  });

  it('records an import and uses its name in both positions', () => {
    const { scalars, prelude } = resolveScalars({ Money: { name: 'Money', from: '../types/money' } });
    expect(scalars.Money).toEqual({ input: 'Money', output: 'Money' });
    expect(prelude.imports).toEqual([{ name: 'Money', from: '../types/money' }]);
    expect(prelude.declarations).toEqual([]);
  });

  it('lets input/output override the imported name without dropping the import', () => {
    const { scalars, prelude } = resolveScalars({
      Money: { name: 'Money', from: '@myorg/types', input: 'Money | string' },
    });
    expect(scalars.Money).toEqual({ input: 'Money | string', output: 'Money' });
    expect(prelude.imports).toEqual([{ name: 'Money', from: '@myorg/types' }]);
  });

  it('records a declaration and uses its name in both positions', () => {
    const body = 'string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue }';
    const { scalars, prelude } = resolveScalars({ JSON: { name: 'JSONValue', declare: body } });
    expect(scalars.JSON).toEqual({ input: 'JSONValue', output: 'JSONValue' });
    expect(prelude.declarations).toEqual([{ name: 'JSONValue', body }]);
    expect(prelude.imports).toEqual([]);
  });

  it('applies the specifier rewriter to every "from"', () => {
    const { prelude } = resolveScalars(
      { A: { name: 'A', from: './a' }, B: { name: 'B', from: 'pkg' } },
      (from) => `<${from}>`,
    );
    expect(prelude.imports).toEqual([
      { name: 'A', from: '<./a>' },
      { name: 'B', from: '<pkg>' },
    ]);
  });

  it('emits one import when two scalars share the same name and source', () => {
    const { prelude } = resolveScalars({
      Metadata: { name: 'JsonValue', from: 'type-fest' },
      Payload: { name: 'JsonValue', from: 'type-fest' },
    });
    expect(prelude.imports).toEqual([{ name: 'JsonValue', from: 'type-fest' }]);
  });

  it('throws when two scalars claim the same name from different sources', () => {
    expect(() =>
      resolveScalars({
        A: { name: 'Shared', from: 'pkg-a' },
        B: { name: 'Shared', from: 'pkg-b' },
      }),
    ).toThrow(/buildql: two scalars both map to a TypeScript type named "Shared"/);
  });

  it('orders the prelude by GraphQL scalar name, so the same config always emits the same bytes', () => {
    const { prelude } = resolveScalars({
      Zebra: { name: 'Zebra', from: 'z' },
      Apple: { name: 'Apple', from: 'a' },
    });
    expect(prelude.imports.map((i) => i.name)).toEqual(['Apple', 'Zebra']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/scalars.test.ts`
Expected: FAIL — `resolveScalars` is not exported from `src/codegen/scalars.ts`.

- [ ] **Step 3: Write the implementation**

Replace the whole of `src/codegen/scalars.ts` with:

```ts
/** GraphQL's five built-in scalars. Everything else must be configured. */
export const DEFAULT_SCALARS: Readonly<Record<string, string>> = {
  ID: 'string',
  String: 'string',
  Int: 'number',
  Float: 'number',
  Boolean: 'boolean',
};

/** Fallback TS type for a custom scalar the user did not map. */
export const UNKNOWN_SCALAR = 'unknown';

/**
 * The object form of a `scalars` entry, for scalars a single inline type expression cannot
 * express. Every key is optional, but the combination is not free-form — `assertScalarsConfig`
 * (in `src/cli/assert-scalars.ts`) rejects the shapes this type alone would still allow:
 *
 * - `{ name, from }`   — import `name` from `from` and use it in both positions.
 * - `{ name, declare }`— emit `export type <name> = <declare>;` and use it in both positions.
 * - `{ input, output }`— raw type expressions, different per position, nothing declared.
 *
 * `input`/`output` may be combined with `name` to override one position while still importing
 * or declaring the named type (e.g. an input that also accepts the raw wire form).
 * `from` and `declare` are mutually exclusive: a type is either imported or declared.
 */
export interface ScalarTypeConfig {
  /** The TypeScript type name this scalar maps to. Required with `from` or `declare`. */
  readonly name?: string;
  /** Module specifier `name` is imported from. See the plan's import-path rule. */
  readonly from?: string;
  /** Right-hand side of a type alias emitted as `export type <name> = <declare>;`. */
  readonly declare?: string;
  /** TS type in argument and input-object-field position. Defaults to `name`, else `output`. */
  readonly input?: string;
  /** TS type in result position. Defaults to `name`, else `input`. */
  readonly output?: string;
}

/** One `scalars` entry: a raw TypeScript type expression, or the object form above. */
export type ScalarConfig = string | ScalarTypeConfig;

/**
 * The TS type a scalar takes in each of the two positions it can appear in. They differ for
 * scalars whose wire form is looser than what the server hands back — a `DateTime` you may
 * pass as `string | Date` but always read back as `string`.
 */
export interface ScalarMapping {
  /** Argument and input-object-field position. */
  readonly input: string;
  /** Result position. */
  readonly output: string;
}

/** One `import type { name } from 'from';` line the generated module must carry. */
export interface ScalarImport {
  readonly name: string;
  readonly from: string;
}

/** One `export type name = body;` alias the generated module must carry. */
export interface ScalarDeclaration {
  readonly name: string;
  readonly body: string;
}

/** Module-level lines the `scalars` config makes the generated module carry. */
export interface ScalarPrelude {
  readonly imports: readonly ScalarImport[];
  readonly declarations: readonly ScalarDeclaration[];
}

export const EMPTY_SCALAR_PRELUDE: ScalarPrelude = { imports: [], declarations: [] };

function toMapping(entry: ScalarConfig): ScalarMapping {
  if (typeof entry === 'string') return { input: entry, output: entry };
  // `name` wins over the other position because it is the whole point of the import/declare
  // forms; `input`/`output` then override whichever position they name. The final
  // `UNKNOWN_SCALAR` is unreachable for validated config and exists so this function is total.
  const fallback = entry.name ?? entry.input ?? entry.output ?? UNKNOWN_SCALAR;
  return { input: entry.input ?? fallback, output: entry.output ?? fallback };
}

export const DEFAULT_SCALAR_MAPPINGS: Readonly<Record<string, ScalarMapping>> = Object.fromEntries(
  Object.entries(DEFAULT_SCALARS).map(([name, ts]) => [name, toMapping(ts)]),
);

/** Rewrites a `from` specifier into one the *generated module* can resolve. Identity by default. */
export type SpecifierRewriter = (from: string) => string;

/** Everything the IR and the emitter need to know about scalars, in one pass over the config. */
export interface ResolvedScalars {
  readonly scalars: Record<string, ScalarMapping>;
  readonly prelude: ScalarPrelude;
}

export function resolveScalars(
  overrides: Readonly<Record<string, ScalarConfig>> = {},
  rewriteFrom: SpecifierRewriter = (from) => from,
): ResolvedScalars {
  const scalars: Record<string, ScalarMapping> = { ...DEFAULT_SCALAR_MAPPINGS };
  // Keyed by the emitted TypeScript name, valued by a description of where it came from. Two
  // scalars naming the same type from the same place is a legitimate way to share one import;
  // naming it from two different places would emit one binding and silently type the second
  // scalar against the first one's type, so it fails loudly instead.
  const sourceOf = new Map<string, string>();
  const imports: ScalarImport[] = [];
  const declarations: ScalarDeclaration[] = [];

  // Sorted, so the same config always produces the same generated bytes. A generated module
  // that is committed to a repo must not churn on `Object.keys` ordering.
  for (const gqlName of Object.keys(overrides).sort()) {
    const entry = overrides[gqlName];
    scalars[gqlName] = toMapping(entry);
    if (typeof entry === 'string' || entry.name === undefined) continue;
    if (entry.from === undefined && entry.declare === undefined) continue;

    const source = entry.from === undefined ? `declare "${entry.declare}"` : `import from "${entry.from}"`;
    const seen = sourceOf.get(entry.name);
    if (seen !== undefined) {
      if (seen !== source) {
        throw new Error(
          `buildql: two scalars both map to a TypeScript type named "${entry.name}", from different ` +
            `sources (${seen} and ${source}). Give one of them a different "name".`,
        );
      }
      continue;
    }
    sourceOf.set(entry.name, source);
    if (entry.from !== undefined) imports.push({ name: entry.name, from: rewriteFrom(entry.from) });
    else if (entry.declare !== undefined) declarations.push({ name: entry.name, body: entry.declare });
  }

  return { scalars, prelude: { imports, declarations } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/scalars.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add src/codegen/scalars.ts test/unit/scalars.test.ts
git commit -m "feat(scalars): resolve scalar config into per-position mappings and a prelude"
```

---

### Task 2: Module specifier rewriting

Turns a `from` written against the config file into one the _generated module_ can resolve. Pure path math, no I/O, so it is fully testable without a filesystem.

**Files:**

- Create: `src/codegen/scalar-imports.ts`
- Test: `test/unit/scalar-imports.test.ts` (create)

**Interfaces:**

- Consumes: nothing from Task 1 — deliberately independent so `resolveScalars` stays path-free.
- Produces:
  - `function isBareSpecifier(spec: string): boolean`
  - `function toOutputRelativeSpecifier(spec: string, configDir: string, outputDir: string): string`

---

- [ ] **Step 1: Write the failing test**

Create `test/unit/scalar-imports.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isBareSpecifier, toOutputRelativeSpecifier } from '../../src/codegen/scalar-imports.js';

describe('isBareSpecifier', () => {
  it('recognises package specifiers', () => {
    expect(isBareSpecifier('type-fest')).toBe(true);
    expect(isBareSpecifier('@myorg/domain-types')).toBe(true);
    expect(isBareSpecifier('node:buffer')).toBe(true);
  });

  it('recognises file paths', () => {
    expect(isBareSpecifier('./types')).toBe(false);
    expect(isBareSpecifier('../types/money')).toBe(false);
    expect(isBareSpecifier('/abs/types')).toBe(false);
  });
});

describe('toOutputRelativeSpecifier', () => {
  it('passes a package specifier through untouched', () => {
    // The published-SDK case: the generated module ships inside a package, and the specifier
    // must resolve from wherever that package lands — no path math can help, and none is done.
    expect(toOutputRelativeSpecifier('@myorg/types', '/repo', '/repo/src/gql')).toBe('@myorg/types');
  });

  it('rewrites a config-relative path to an output-relative one', () => {
    expect(toOutputRelativeSpecifier('./src/types/money', '/repo', '/repo/src/gql')).toBe('../types/money');
  });

  it('prefixes "./" when the target sits inside the output directory', () => {
    // `relative()` yields a bare `scalars`, which would read as a *package* specifier.
    expect(toOutputRelativeSpecifier('./src/gql/scalars', '/repo', '/repo/src/gql')).toBe('./scalars');
  });

  it('preserves the extension exactly as written, for nodenext projects', () => {
    expect(toOutputRelativeSpecifier('./src/types/money.js', '/repo', '/repo/src/gql')).toBe(
      '../types/money.js',
    );
  });

  it('rewrites an absolute path too', () => {
    expect(toOutputRelativeSpecifier('/repo/src/types/money', '/repo', '/repo/src/gql')).toBe(
      '../types/money',
    );
  });

  it('emits forward slashes regardless of the host platform', () => {
    expect(toOutputRelativeSpecifier('./a/b/c/money', '/repo', '/repo/gen')).not.toContain('\\');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/scalar-imports.test.ts`
Expected: FAIL — `Cannot find module '../../src/codegen/scalar-imports.js'`

- [ ] **Step 3: Write the implementation**

Create `src/codegen/scalar-imports.ts`:

```ts
import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * True when `spec` names a *package* rather than a file on disk — it neither starts with `.`
 * nor is absolute. Bare specifiers are emitted verbatim: when the generated module is
 * published as an npm package (generated in the backend repo, consumed by the frontend), a
 * bare specifier is the only form that still resolves from inside the published package,
 * and rewriting it against a directory layout that no longer exists would break it.
 */
export function isBareSpecifier(spec: string): boolean {
  return !spec.startsWith('.') && !isAbsolute(spec);
}

/**
 * Re-expresses a file-path specifier, written relative to the *config file*, as one relative
 * to the *generated module*. Relative paths in `buildql.config.*` already resolve against the
 * config's own directory (`schema`, `output`), so `scalars[...].from` does the same rather
 * than making the user do path arithmetic against `output` by hand — and so that changing
 * `output` later cannot silently break the import.
 *
 * The extension (or absence of one) is preserved exactly as written, since this is pure
 * string path math: a `nodenext` project writing `'./types/money.js'` gets `.js` back.
 */
export function toOutputRelativeSpecifier(spec: string, configDir: string, outputDir: string): string {
  if (isBareSpecifier(spec)) return spec;
  const target = resolve(configDir, spec);
  const rel = relative(outputDir, target).split(sep).join('/');
  // `relative()` returns '' when the two paths are identical, and returns a bare `name` (no
  // leading `./`) for anything directly inside `outputDir` — which would read as a *package*
  // specifier, not a sibling file. Both need the explicit relative prefix put back.
  if (rel.length === 0) return '.';
  return rel.startsWith('.') ? rel : `./${rel}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/scalar-imports.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/codegen/scalar-imports.ts test/unit/scalar-imports.test.ts
git commit -m "feat(scalars): rewrite config-relative type imports against the output directory"
```

---

### Task 3: Config validation

`scalars` currently accepts only a string record and is validated inline in `assertBuildQLConfig`. The new shape needs enough validation that no malformed config can reach codegen and produce a generated file that fails to compile hundreds of lines from the cause. The validator moves to its own file — `src/cli/config.ts` is already 172 lines and this adds ~70.

**Files:**

- Create: `src/cli/assert-scalars.ts`
- Modify: `src/cli/config.ts` (the `scalars` field type at line 17, the `scalars` check at lines 95-97)
- Test: `test/unit/config.test.ts` (add cases after the existing `'errors clearly when scalars is not a string record'` test at line ~76)

**Interfaces:**

- Consumes: `ScalarConfig`, `ScalarTypeConfig` from `src/codegen/scalars.js` (Task 1).
- Produces:
  - `function assertScalarsConfig(configName: string, value: unknown): asserts value is Record<string, ScalarConfig>`
  - `BuildQLConfig.scalars?: Record<string, ScalarConfig>`
  - `src/cli/config.ts` re-exports the types `ScalarConfig` and `ScalarTypeConfig`, so `buildql/config` consumers get `defineConfig` type-checking on the new form.

---

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/config.test.ts`, inside the existing `describe('loadConfig', ...)` block. These follow the file's existing pattern: write a real config into a temp dir, then assert on the rejection.

```ts
/** Writes `source` as the default export of a buildql.config.mjs in a fresh temp dir. */
async function configDir(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cfg-'));
  await writeFile(join(dir, 'buildql.config.mjs'), `export default { schema: './s.graphql', ${source} };\n`);
  return dir;
}

it('accepts the object form of a scalars entry', async () => {
  const dir = await configDir(
    "scalars: { Money: { name: 'Money', from: './src/types/money' }, DateTime: { input: 'string | Date', output: 'string' }, Plain: 'string' }",
  );
  const { config } = await loadConfig(dir);
  expect(config.scalars).toEqual({
    Money: { name: 'Money', from: './src/types/money' },
    DateTime: { input: 'string | Date', output: 'string' },
    Plain: 'string',
  });
});

it('rejects a scalars entry that is neither a string nor an object', async () => {
  const dir = await configDir('scalars: { DateTime: 42 }');
  await expect(loadConfig(dir)).rejects.toThrow(/"scalars\.DateTime"/);
});

it('rejects an empty string scalars entry', async () => {
  const dir = await configDir("scalars: { DateTime: '' }");
  await expect(loadConfig(dir)).rejects.toThrow(/"scalars\.DateTime".*empty/);
});

it('rejects an unknown key, so a typo does not silently do nothing', async () => {
  const dir = await configDir("scalars: { DateTime: { ouput: 'string' } }");
  await expect(loadConfig(dir)).rejects.toThrow(/unknown key "ouput"/);
});

it('rejects "from" and "declare" together', async () => {
  const dir = await configDir("scalars: { J: { name: 'J', from: 'pkg', declare: 'string' } }");
  await expect(loadConfig(dir)).rejects.toThrow(/both "from" and "declare"/);
});

it('rejects a "name" that is not a valid TypeScript identifier', async () => {
  const dir = await configDir("scalars: { J: { name: 'my type', from: 'pkg' } }");
  await expect(loadConfig(dir)).rejects.toThrow(/"scalars\.J\.name" \("my type"\) is not a valid/);
});

it('rejects "name" without "from" or "declare", which would declare nothing', async () => {
  const dir = await configDir("scalars: { J: { name: 'J' } }");
  await expect(loadConfig(dir)).rejects.toThrow(/neither "from" nor "declare"/);
});

it('rejects an empty scalars object entry', async () => {
  const dir = await configDir('scalars: { J: {} }');
  await expect(loadConfig(dir)).rejects.toThrow(/"scalars\.J" is empty/);
});

it('rejects a non-string "from"', async () => {
  const dir = await configDir("scalars: { J: { name: 'J', from: 42 } }");
  await expect(loadConfig(dir)).rejects.toThrow(/"scalars\.J\.from" must be a non-empty string/);
});

it('rejects an array scalars entry, which Object.entries would otherwise walk', async () => {
  const dir = await configDir("scalars: { J: ['string'] }");
  await expect(loadConfig(dir)).rejects.toThrow(/"scalars\.J"/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/config.test.ts`
Expected: FAIL — the object-form config is rejected by the current `isStringRecord` check, and the specific messages do not exist.

- [ ] **Step 3: Write the validator**

Create `src/cli/assert-scalars.ts`:

```ts
import type { ScalarConfig } from '../codegen/scalars.js';

/** The only keys a `scalars` object entry may carry. Anything else is a typo. */
const SCALAR_KEYS = ['name', 'from', 'declare', 'input', 'output'] as const;

/**
 * What `name` must look like to be spliced into `import type { <name> }` / `export type <name>`.
 * Deliberately ASCII-only: TypeScript accepts a far wider set of identifier characters, but a
 * `name` outside this shape is overwhelmingly a mistake, and the failure it causes otherwise —
 * a syntax error inside a generated file — is much harder to trace back to the config line.
 */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Narrows to a plain object — arrays are excluded, since `Object.entries` would walk their indices. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(
  configName: string,
  scalar: string,
  key: string,
  value: unknown,
): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`buildql: ${configName}'s "scalars.${scalar}.${key}" must be a non-empty string`);
  }
}

/**
 * Throws a field-specific `buildql:`-prefixed error unless every `scalars` entry is a non-empty
 * TypeScript type string, or one of the three object shapes documented on `ScalarTypeConfig`.
 * Every message names the offending scalar, because the alternative — finding out at `tsc` time
 * from a generated file the user did not write — is exactly what this exists to prevent.
 */
export function assertScalarsConfig(
  configName: string,
  value: unknown,
): asserts value is Record<string, ScalarConfig> {
  if (!isPlainRecord(value)) {
    throw new Error(`buildql: ${configName}'s "scalars" must be a record keyed by GraphQL scalar name`);
  }
  for (const [scalar, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      if (entry.length === 0) {
        throw new Error(`buildql: ${configName}'s "scalars.${scalar}" must not be an empty string`);
      }
      continue;
    }
    if (!isPlainRecord(entry)) {
      throw new Error(
        `buildql: ${configName}'s "scalars.${scalar}" must be a TypeScript type string, or an object ` +
          `with "input"/"output", "name" + "from", or "name" + "declare"`,
      );
    }
    for (const key of Object.keys(entry)) {
      if (!(SCALAR_KEYS as readonly string[]).includes(key)) {
        throw new Error(
          `buildql: ${configName}'s "scalars.${scalar}" has an unknown key "${key}" — expected one of ` +
            SCALAR_KEYS.map((k) => `"${k}"`).join(', '),
        );
      }
    }

    const { name, from, declare, input, output } = entry;
    if (from !== undefined && declare !== undefined) {
      throw new Error(
        `buildql: ${configName}'s "scalars.${scalar}" sets both "from" and "declare" — a type is ` +
          `either imported or declared, not both`,
      );
    }
    if (from !== undefined) assertNonEmptyString(configName, scalar, 'from', from);
    if (declare !== undefined) assertNonEmptyString(configName, scalar, 'declare', declare);
    if (input !== undefined) assertNonEmptyString(configName, scalar, 'input', input);
    if (output !== undefined) assertNonEmptyString(configName, scalar, 'output', output);

    if (name !== undefined) {
      assertNonEmptyString(configName, scalar, 'name', name);
      if (!IDENTIFIER.test(name)) {
        throw new Error(
          `buildql: ${configName}'s "scalars.${scalar}.name" ("${name}") is not a valid TypeScript identifier`,
        );
      }
      if (from === undefined && declare === undefined) {
        throw new Error(
          `buildql: ${configName}'s "scalars.${scalar}" sets "name" but neither "from" nor "declare" — ` +
            `nothing in the generated module would declare that type`,
        );
      }
    } else if (input === undefined && output === undefined) {
      throw new Error(
        `buildql: ${configName}'s "scalars.${scalar}" is empty — set "input"/"output", or "name" ` +
          `together with "from" or "declare"`,
      );
    }
  }
}
```

- [ ] **Step 4: Wire it into `src/cli/config.ts`**

Add to the imports at the top of the file:

```ts
import { assertScalarsConfig } from './assert-scalars.js';
import type { ScalarConfig } from '../codegen/scalars.js';
```

Add to the type re-exports next to the existing `export type { ClientKind } ...` line:

```ts
export type { ScalarConfig, ScalarTypeConfig } from '../codegen/scalars.js';
```

Replace the `scalars` field on `BuildQLConfig` (line 16-17):

````ts
  /**
   * Maps custom GraphQL scalars to TypeScript types. A string is a raw type expression used in
   * both argument and result position (`{ DateTime: 'string' }`); the object form covers types a
   * single expression cannot express — see `ScalarTypeConfig`:
   *
   * ```js
   * scalars: {
   *   DateTime: { input: 'string | Date', output: 'string' },
   *   Money:    { name: 'Money', from: './src/types/money' },
   *   JSON:     { name: 'JSONValue', declare: 'string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue }' },
   * }
   * ```
   *
   * A relative `from` is written against *this config file* and rewritten against `output`;
   * a package specifier is emitted verbatim, which is what a generated module published as an
   * npm package needs.
   */
  readonly scalars?: Record<string, ScalarConfig>;
````

Replace the `scalars` check inside `assertBuildQLConfig` (lines 95-97):

```ts
if (value.scalars !== undefined) assertScalarsConfig(name, value.scalars);
```

Leave `isStringRecord` in place — `headers` still uses it. Update its JSDoc, which currently claims it covers `scalars`:

```ts
/** True when every own value of `value` is a string (used for the `headers` map). */
```

Update the `assertBuildQLConfig` doc comment's last clause from `string-valued \`headers\`/\`scalars\` records` to:

```
 * string-valued `headers` record and a well-formed `scalars` map (see `assertScalarsConfig`).
```

- [ ] **Step 5: Update the now-stale existing test**

`test/unit/config.test.ts` has `it('errors clearly when scalars is not a string record', ...)` asserting on `scalars: { DateTime: 42 }`. Its expectation `/buildql:.*"scalars"/` still matches the new `"scalars.DateTime"` message, but the title now lies. Rename it:

```ts
  it('errors clearly when a scalars entry is neither a string nor an object', async () => {
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/unit/config.test.ts`
Expected: PASS — all existing cases plus the 10 new ones.

- [ ] **Step 7: Commit**

```bash
git add src/cli/assert-scalars.ts src/cli/config.ts test/unit/config.test.ts
git commit -m "feat(config): accept and validate the object form of a scalars entry"
```

---

### Task 4: Carry input/output mappings through the IR

The IR's `scalars` becomes a map of `ScalarMapping` instead of `string`, and gains `scalarPrelude`. `ts-types.ts` then picks `.output` in result position and `.input` in argument position — the change that makes split types actually mean anything.

**Files:**

- Modify: `src/codegen/ir.ts:44-50` (`IRSchema`), `src/codegen/ir.ts:105-141` (`buildIR`)
- Modify: `src/codegen/ts-types.ts:1-20` (`scalarTsType`, `leafTsType`), `src/codegen/ts-types.ts:88-90` (`inputTsType`)
- Test: `test/unit/ir.test.ts` (the two scalar tests at the end), `test/unit/ts-types.test.ts` (the `schemaWithScalars` helper, plus new split-position cases)

**Interfaces:**

- Consumes: `ResolvedScalars`, `ScalarMapping`, `ScalarPrelude`, `resolveScalars`, `DEFAULT_SCALAR_MAPPINGS`, `EMPTY_SCALAR_PRELUDE` from Task 1.
- Produces:
  - `IRSchema.scalars: Record<string, ScalarMapping>`
  - `IRSchema.scalarPrelude: ScalarPrelude`
  - `buildIR(schema: IntrospectionResult, scalars?: ResolvedScalars): IRSchema`
  - `leafTsType`/`inputTsType`/`argTsType`/`unmappedScalars` keep their existing signatures.

---

- [ ] **Step 1: Write the failing tests**

In `test/unit/ts-types.test.ts`, replace the `schemaWithScalars` helper (lines 5-20) so it normalises string shorthand into mappings — this keeps all twelve existing assertions in the file working unchanged — and add the split-position cases:

```ts
import { expect, it } from 'vitest';
import { inputTsType, leafTsType } from '../../src/codegen/ts-types.js';
import { resolveScalars } from '../../src/codegen/scalars.js';
import type { IRSchema, IRTypeRef } from '../../src/codegen/ir.js';
import type { ScalarConfig } from '../../src/codegen/scalars.js';

/** A minimal IRSchema carrying only the scalar map `inputTsType`/`leafTsType` read. */
function schemaWithScalars(scalars: Record<string, ScalarConfig>): IRSchema {
  const resolved = resolveScalars(scalars);
  return {
    queryType: 'Query',
    mutationType: null,
    subscriptionType: null,
    types: [],
    scalars: resolved.scalars,
    scalarPrelude: resolved.prelude,
  };
}
```

Then append these tests to the end of the same file:

```ts
const nonNullRef: IRTypeRef = { wrap: ['!'], name: 'JSON', kind: 'scalar' };

it('reads the output type in result position and the input type in argument position', () => {
  const ir = schemaWithScalars({ JSON: { input: 'string | Date', output: 'string' } });
  expect(leafTsType(nonNullRef, ir)).toBe('string');
  expect(inputTsType(nonNullRef, ir)).toBe('string | Date');
});

it('still parenthesises a split input type inside a list', () => {
  // The atomicity guard applies to whichever expression the *input* side resolved to,
  // not to whatever the output side happens to be.
  const ir = schemaWithScalars({ JSON: { input: 'string | Date', output: 'string' } });
  expect(inputTsType(listOfNonNull, ir)).toBe('(string | Date)[] | null');
});

it('uses an imported name in both positions', () => {
  const ir = schemaWithScalars({ JSON: { name: 'Money', from: './money' } });
  expect(leafTsType(nonNullRef, ir)).toBe('Money');
  expect(inputTsType(nonNullRef, ir)).toBe('Money');
});

it('falls back to unknown in both positions for a scalar with no entry', () => {
  const ir = schemaWithScalars({});
  expect(leafTsType(nonNullRef, ir)).toBe('unknown');
  expect(inputTsType(nonNullRef, ir)).toBe('unknown');
});
```

In `test/unit/ir.test.ts`, replace the two scalar tests at the end of the file:

```ts
it('applies scalar overrides', async () => {
  const s = buildIR(await loadSchema(sdlPath), resolveScalars({ ID: 'PostId' }));
  expect(s.scalars.ID).toEqual({ input: 'PostId', output: 'PostId' });
  expect(s.scalars.String).toEqual({ input: 'string', output: 'string' });
});

it('carries the scalar prelude through to the IR', async () => {
  const s = buildIR(await loadSchema(sdlPath), resolveScalars({ ID: { name: 'PostId', from: './ids' } }));
  expect(s.scalarPrelude.imports).toEqual([{ name: 'PostId', from: './ids' }]);
});

it('builds the scalars map with a null prototype, so a scalar named "toString" cannot resolve via Object.prototype', async () => {
  const s = await ir();
  expect(Object.getPrototypeOf(s.scalars)).toBe(null);
  expect(Object.hasOwn(s.scalars, 'toString')).toBe(false);
  expect(s.scalars['toString']).toBeUndefined();
});
```

Add `resolveScalars` to that file's imports:

```ts
import { resolveScalars } from '../../src/codegen/scalars.js';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/ts-types.test.ts test/unit/ir.test.ts`
Expected: FAIL — `IRSchema` has no `scalarPrelude`, `buildIR`'s second parameter is still a string record, and `leafTsType` returns the whole mapping object.

- [ ] **Step 3: Update the IR**

In `src/codegen/ir.ts`, replace the `DEFAULT_SCALARS` import (line 7) with:

```ts
import { resolveScalars } from './scalars.js';
import type { ResolvedScalars, ScalarMapping, ScalarPrelude } from './scalars.js';
```

Replace the `scalars` field on `IRSchema` (line 49) with:

```ts
  readonly scalars: Record<string, ScalarMapping>;
  /** `import type` lines and type aliases the scalar config makes the generated module carry. */
  readonly scalarPrelude: ScalarPrelude;
```

Replace `buildIR`'s signature (lines 105-108) with:

```ts
export function buildIR(
  schema: IntrospectionResult,
  scalars: ResolvedScalars = resolveScalars(),
): IRSchema {
```

Replace the `scalars:` property in the returned object (lines 135-139) with:

```ts
    // A null-prototype target means a scalar legitimately named `toString`, `valueOf`,
    // or `constructor` cannot resolve to an inherited `Object.prototype` member on
    // either an `in`/`Object.hasOwn` membership check or a plain bracket read — there
    // is no prototype chain left to walk. `resolveScalars` has already merged the
    // built-in five underneath the user's overrides.
    scalars: Object.assign(Object.create(null) as Record<string, ScalarMapping>, scalars.scalars),
    scalarPrelude: scalars.prelude,
```

- [ ] **Step 4: Update `ts-types.ts` to read by position**

In `src/codegen/ts-types.ts`, add `ScalarMapping` to the type imports:

```ts
import type { ScalarMapping } from './scalars.js';
```

Change `scalarTsType`'s return type and both call sites. The function body and its doc comment are unchanged apart from the type:

```ts
function scalarTsType(ir: IRSchema, name: string): ScalarMapping | undefined {
  return Object.hasOwn(ir.scalars, name) ? ir.scalars[name] : undefined;
}

/** The TypeScript type a *leaf* (scalar/enum) named type maps to, in **result** position. */
export function leafTsType(ref: IRTypeRef, ir: IRSchema): string {
  if (ref.kind === 'enum') return ref.name;
  return scalarTsType(ir, ref.name)?.output ?? UNKNOWN_SCALAR;
}
```

And in `inputTsType` (lines 89-90):

```ts
const base =
  ref.kind === 'input' || ref.kind === 'enum'
    ? ref.name
    : (scalarTsType(ir, ref.name)?.input ?? UNKNOWN_SCALAR);
```

`unmappedScalars` is unchanged — it only tests key presence.

Note for the implementer: `leafTsType`'s result is spliced into a type-argument list (`leafField<'x', ['!'], TS>`), where `|` and `&` bind tighter than the `,` separating arguments, so it needs no atomicity guard. `inputTsType`'s does — that is what `isAtomicTypeExpression` is for, and it now guards the `input` expression specifically.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/unit/ts-types.test.ts test/unit/ir.test.ts`
Expected: PASS. `test/unit/emit.test.ts` will still fail to type-check at this point — Task 5 fixes its hand-built `IRSchema` literals.

- [ ] **Step 6: Commit**

```bash
git add src/codegen/ir.ts src/codegen/ts-types.ts test/unit/ir.test.ts test/unit/ts-types.test.ts
git commit -m "feat(codegen): type scalars per position and carry the prelude on the IR"
```

---

### Task 5: Emit the scalar prelude, and refuse to emit a colliding name

The generated module gains its `import type` lines and `export type` aliases. It also gains a guard: a `scalars` entry that names a type the module already binds would produce a duplicate-identifier error inside a file the user did not write, so `emit` throws first and names both sides.

**Files:**

- Modify: `src/codegen/emit.ts` (adds ~55 lines to the current 125 — still under the ~200-line split threshold, and the naming scheme it checks against lives here, so splitting it out would only duplicate that knowledge)
- Test: `test/unit/emit.test.ts` (four hand-built `IRSchema` literals need the new field; new prelude and collision tests)

**Interfaces:**

- Consumes: `ScalarPrelude` from Task 1; `IRSchema.scalarPrelude` from Task 4.
- Produces: `emit(ir: IRSchema, client?: ClientKind): string` — same signature, new output section and a new throw.

---

- [ ] **Step 1: Fix the hand-built IRSchema literals so the file type-checks**

`test/unit/emit.test.ts` builds four `IRSchema` objects by hand, each with a `scalars: DEFAULT_SCALARS,` line (around lines 64, 138, 194 and 346). Change the import on line 8:

```ts
import { DEFAULT_SCALAR_MAPPINGS, EMPTY_SCALAR_PRELUDE } from '../../src/codegen/scalars.js';
```

and replace each of the four `scalars: DEFAULT_SCALARS,` lines with:

```ts
      scalars: DEFAULT_SCALAR_MAPPINGS,
      scalarPrelude: EMPTY_SCALAR_PRELUDE,
```

(Indentation matches whatever the surrounding literal uses — three of them sit at four spaces inside the object literal, one at six. Prettier will settle it.)

- [ ] **Step 2: Write the failing tests**

Append to `test/unit/emit.test.ts`, inside the `describe('emit', ...)` block:

```ts
/** The SDL fixture has no custom scalar, so prelude cases build the IR with overrides. */
async function generatedWith(overrides: Record<string, ScalarConfig>) {
  return emit(buildIR(await loadSchema(sdlPath), resolveScalars(overrides)));
}

it('emits nothing extra when no scalar contributes a prelude', async () => {
  // Pins the byte-identical-by-default promise: a config that only uses the string form
  // must produce exactly what buildql produced before the object form existed.
  expect(await generatedWith({ ID: 'string' })).toBe(await generated());
});

it('emits a type-only import for an imported scalar type', async () => {
  const src = await generatedWith({ ID: { name: 'PostId', from: '../types/ids' } });
  expect(src).toContain("import type { PostId } from '../types/ids';");
  // Type-only, so the generated module carries no runtime dependency on the user's module —
  // which is what lets it be published as a package with the types in devDependencies.
  expect(src).not.toContain('import { PostId }');
});

it('exports a declared scalar type so consumers can name it', async () => {
  const src = await generatedWith({ ID: { name: 'PostId', declare: 'string & { __brand: "post" }' } });
  expect(src).toContain('export type PostId = string & { __brand: "post" };');
});

it('groups imports by module and sorts both groups and names', async () => {
  const src = await generatedWith({
    ID: { name: 'Zed', from: 'z-pkg' },
    String: { name: 'Beta', from: 'a-pkg' },
    Int: { name: 'Alpha', from: 'a-pkg' },
  });
  expect(src).toContain("import type { Alpha, Beta } from 'a-pkg';\nimport type { Zed } from 'z-pkg';");
});

it('places the prelude after the runtime import and before the generated types', async () => {
  const src = await generatedWith({ ID: { name: 'PostId', from: '../types/ids' } });
  expect(src.indexOf("from 'buildql'")).toBeLessThan(src.indexOf("from '../types/ids'"));
  expect(src.indexOf("from '../types/ids'")).toBeLessThan(src.indexOf('export const Post = {'));
});

it('uses the mapped scalar types in both positions in the generated module', async () => {
  const src = await generatedWith({ ID: { input: 'string | number', output: 'string' } });
  expect(src).toContain("id: leafField<'id', ['!'], string>('id', ['!'])");
  expect(src).toContain("argSpec<{ id: string | number }>({ id: 'ID!' })");
});

it('throws when a scalar type name collides with a generated schema type', async () => {
  await expect(generatedWith({ ID: { name: 'Post', declare: 'string' } })).rejects.toThrow(
    /buildql: a "scalars" entry maps to a TypeScript type named "Post"/,
  );
});

it('throws when a scalar type name collides with a fragment helper', async () => {
  await expect(generatedWith({ ID: { name: 'postFragment', declare: 'string' } })).rejects.toThrow(
    /named "postFragment"/,
  );
});

it('throws when a scalar type name collides with a runtime import', async () => {
  await expect(generatedWith({ ID: { name: 'leafField', from: 'pkg' } })).rejects.toThrow(
    /named "leafField"/,
  );
});
```

Add to that file's imports:

```ts
import { resolveScalars } from '../../src/codegen/scalars.js';
import type { ScalarConfig } from '../../src/codegen/scalars.js';
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/unit/emit.test.ts`
Expected: FAIL — no prelude appears in the output and nothing throws on a colliding name.

- [ ] **Step 4: Write the implementation**

In `src/codegen/emit.ts`, add to the type imports at the top:

```ts
import type { ScalarPrelude } from './scalars.js';
```

Insert these three functions after `reexportBlock` (i.e. after line 45):

```ts
/**
 * The `import type` lines and type aliases contributed by the `scalars` config. They sit
 * between the runtime import and the generated types, so an alias can reference another alias
 * (or itself, for a recursive JSON type) and every type map below can reference all of them.
 *
 * Imports are grouped by module, and modules and names are each sorted, so the same config
 * always produces the same bytes — a generated module that is committed to a repo must not
 * churn on iteration order. `import type` rather than a value import keeps the generated
 * module free of any *runtime* dependency on the user's type module, which is what allows it
 * to be published as a package whose type sources are only a devDependency.
 */
function scalarPreludeBlock(prelude: ScalarPrelude): string {
  const byModule = new Map<string, Set<string>>();
  for (const { name, from } of prelude.imports) {
    const names = byModule.get(from) ?? new Set<string>();
    names.add(name);
    byModule.set(from, names);
  }
  // Plain `<`/`>` rather than `localeCompare`: this ordering must not vary with the host
  // machine's locale, or the same config would emit different bytes on different machines.
  const lines = [...byModule.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([from, names]) => `import type { ${[...names].sort().join(', ')} } from '${from}';`);
  const decls = [...prelude.declarations]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((d) => `export type ${d.name} = ${d.body};`);
  if (lines.length === 0 && decls.length === 0) return '';
  return `${[...lines, ...decls].join('\n')}\n`;
}

/** Every name the generated module already binds, before the scalar prelude adds its own. */
function reservedNames(ir: IRSchema, client: ClientKind): Set<string> {
  const names = new Set<string>([
    ...CORE_IMPORTS,
    ...CLIENT_EMITS[client].names,
    '$',
    'v',
    'Operation',
    'query',
  ]);
  if (ir.mutationType) names.add('mutation');
  if (ir.subscriptionType) names.add('subscription');
  for (const t of ir.types) {
    // Scalar types emit no binding of their own — mapping the scalar `JSON` to a type also
    // named `JSON` is fine, and is in fact the obvious thing for a user to write.
    if (t.kind === 'scalar') continue;
    names.add(t.name);
    if (t.kind === 'enum') names.add(`${t.name}Values`);
    if (t.kind === 'object' || t.kind === 'interface' || t.kind === 'union') {
      names.add(`${lowerFirst(t.name)}Fragment`);
    }
  }
  return names;
}

/**
 * The `scalars` config can name any TypeScript type it likes, including one this emitter
 * already binds — `export type Money = ...` next to the schema's own `Money` input object is a
 * duplicate-identifier error reported against a generated file the user never wrote, hundreds
 * of lines from the config entry that caused it. Fail here instead, naming the collision.
 */
function assertNoScalarNameCollisions(ir: IRSchema, client: ClientKind): void {
  const reserved = reservedNames(ir, client);
  const declared = [
    ...ir.scalarPrelude.imports.map((i) => i.name),
    ...ir.scalarPrelude.declarations.map((d) => d.name),
  ];
  for (const name of declared) {
    if (reserved.has(name)) {
      throw new Error(
        `buildql: a "scalars" entry maps to a TypeScript type named "${name}", which the generated ` +
          `module already binds. Give it a different "name" in your buildql.config.*.`,
      );
    }
  }
}
```

Then change `emit` itself (lines 103-105) to:

```ts
export function emit(ir: IRSchema, client: ClientKind = 'buildql'): string {
  assertNoScalarNameCollisions(ir, client);
  const parts: string[] = [HEADER, importBlock(client)];
  // Pushed only when non-empty: `parts` is joined with '\n', so an empty string here would
  // add a blank line and break the byte-identical-by-default promise for string-form configs.
  const prelude = scalarPreludeBlock(ir.scalarPrelude);
  if (prelude.length > 0) parts.push(prelude);
```

`lowerFirst` is already defined in this file (line 47) and function declarations hoist, so the forward reference from `reservedNames` is fine.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/unit/emit.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/codegen/emit.ts test/unit/emit.test.ts
git commit -m "feat(emit): render scalar type imports and declarations, guard name collisions"
```

---

### Task 6: Wire the CLI end to end

`generate` is the only place that knows both the config directory and the resolved output directory, so it is where the specifier rewriter is built.

**Files:**

- Modify: `src/cli/generate.ts:26` (the `buildIR` call) and `:47` (the `resolveOutputDir` call, which moves earlier)
- Test: `test/unit/cli.test.ts` (add after the existing `'applies scalar overrides from config'` test at line ~45)

**Interfaces:**

- Consumes: `resolveScalars` (Task 1), `toOutputRelativeSpecifier` (Task 2), `buildIR(schema, ResolvedScalars)` (Task 4).
- Produces: no signature change — `generate(config, cwd, reporter?)` still returns the written file's path.

---

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/cli.test.ts` (the file already has helpers for writing a fixture schema into a temp dir — follow the pattern used by the existing `'applies scalar overrides from config'` test, reading the generated file back with `readFile`):

```ts
it('rewrites a config-relative scalar import against the output directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-'));
  await writeFile(join(dir, 'schema.graphql'), await readFile(fixtureSdl, 'utf8'));
  const out = await generate(
    {
      schema: './schema.graphql',
      output: './src/gql',
      scalars: { ID: { name: 'PostId', from: './src/types/ids' } },
    },
    dir,
  );
  // `from` is written against the config file; the generated module lives two levels deeper.
  expect(await readFile(out, 'utf8')).toContain("import type { PostId } from '../types/ids';");
});

it('leaves a package specifier alone, so a published generated module still resolves it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-'));
  await writeFile(join(dir, 'schema.graphql'), await readFile(fixtureSdl, 'utf8'));
  const out = await generate(
    {
      schema: './schema.graphql',
      output: './src/gql',
      scalars: { ID: { name: 'JsonValue', from: '@myorg/domain-types' } },
    },
    dir,
  );
  expect(await readFile(out, 'utf8')).toContain("import type { JsonValue } from '@myorg/domain-types';");
});

it('tells the user which type modules the generated module now imports from', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-'));
  await writeFile(join(dir, 'schema.graphql'), await readFile(fixtureSdl, 'utf8'));
  const reporter = collectingReporter();
  await generate(
    { schema: './schema.graphql', output: '.', scalars: { ID: { name: 'PostId', from: './ids' } } },
    dir,
    reporter,
  );
  expect(reporter.infos.join('\n')).toContain('./ids');
});

it('says nothing about scalar imports when no scalar declares one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-cli-'));
  await writeFile(join(dir, 'schema.graphql'), await readFile(fixtureSdl, 'utf8'));
  const reporter = collectingReporter();
  await generate({ schema: './schema.graphql', output: '.', scalars: { ID: 'string' } }, dir, reporter);
  expect(reporter.infos.join('\n')).not.toContain('import');
});
```

The implementer should match the existing file's helper for getting the fixture SDL into the temp dir rather than introducing a new `fixtureSdl` binding if one is already there under another name — read lines 1-50 of `test/unit/cli.test.ts` first and reuse what it already does.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/cli.test.ts`
Expected: FAIL — the generated file has no import line, and no info message mentions the module.

- [ ] **Step 3: Write the implementation**

In `src/cli/generate.ts`, add to the imports:

```ts
import { toOutputRelativeSpecifier } from '../codegen/scalar-imports.js';
import { resolveScalars } from '../codegen/scalars.js';
```

Replace the body of `generate` from the `loadSchema` call through the `buildIR` call (lines 25-26) with:

```ts
const schema = await loadSchema(resolveSchemaSource(config.schema, cwd), { headers: config.headers });

// `dir` is computed before the IR, not after: a relative `scalars[...].from` is written
// against the config file and has to be re-expressed against the directory the generated
// module actually lands in, which only `resolveOutputDir` knows.
const dir = resolveOutputDir(config, cwd);
const scalars = resolveScalars(config.scalars, (from) => toOutputRelativeSpecifier(from, cwd, dir));
const ir = buildIR(schema, scalars);
```

Add, immediately after the existing `unmapped` warning block (after line 34):

```ts
if (scalars.prelude.imports.length > 0) {
  const modules = [...new Set(scalars.prelude.imports.map((i) => i.from))].sort();
  reporter.info(
    `buildql: the generated module imports scalar types from ${modules.join(', ')} ` +
      `(relative specifiers are resolved against your config file, then rewritten against "output")`,
  );
}
```

Finally, delete the now-duplicated `const dir = resolveOutputDir(config, cwd);` further down (line 47), leaving the `mkdir`/`join`/`writeFile` sequence to use the `dir` computed above.

- [ ] **Step 4: Run the full unit suite**

Run: `npx vitest run test/unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/generate.ts test/unit/cli.test.ts
git commit -m "feat(cli): resolve scalar type imports against the output directory"
```

---

### Task 7: End-to-end proof against a real server

Unit tests prove the strings are right; this proves the generated module actually compiles under strict `tsc` with all three forms in play — including a rewritten relative import that has to resolve on disk — and that the values round-trip through a real GraphQL server.

**Files:**

- Modify: `test/e2e/fixtures/server.ts` (three custom scalars, one new field, their resolvers)
- Modify: `test/e2e/generate-and-run.test.ts` (one new `it(...)`, appended after the urql test)

**Interfaces:**

- Consumes: everything from Tasks 1-6.
- Produces: no new exports. `startServer()` keeps its `{ url, stop }` shape.

---

- [ ] **Step 1: Add the custom scalars to the fixture server**

In `test/e2e/fixtures/server.ts`, add the import:

```ts
import { GraphQLScalarType } from 'graphql';
```

Add to `typeDefs`, inside the template literal — a new `Query` field plus the types it needs:

```graphql
scalar Money
scalar Metadata
scalar Timestamp
```

Add `postMeta(id: ID!, since: Timestamp): PostMeta!` to the `Query` block, and this type after `Post`:

```graphql
type PostMeta {
  id: ID!
  metadata: Metadata!
  updatedAt: Timestamp!
  price: Money!
}
```

Add above `startServer`:

```ts
/**
 * A custom scalar that transports its JSON value untouched. Enough for a codegen end-to-end:
 * what is under test is the *types* buildql generates for a scalar, not the server's coercion.
 * `parseLiteral` is left at its default (`valueFromASTUntyped`), which already handles object
 * and list literals.
 */
function passthroughScalar(name: string): GraphQLScalarType {
  return new GraphQLScalarType({ name, serialize: (v: unknown) => v, parseValue: (v: unknown) => v });
}
```

Add to `resolvers`, alongside `Query` and `Mutation`:

```ts
        Money: passthroughScalar('Money'),
        Metadata: passthroughScalar('Metadata'),
        Timestamp: passthroughScalar('Timestamp'),
```

And add to the `Query` resolvers:

```ts
          postMeta: (_: unknown, a: { id: string }) => ({
            id: a.id,
            metadata: { tags: ['a', 'b'], views: 42 },
            updatedAt: '2026-08-07T00:00:00.000Z',
            price: { amount: 999, currency: 'USD' },
          }),
```

Note for the implementer: the existing e2e tests generate against this same server with no `scalars` config, so these three now surface in the "unmapped custom scalars" warning and generate as `unknown`. That is a warning, not a failure, and no existing `usage.ts` selects the new field — the existing tests must keep passing unchanged. Confirm that in Step 3.

- [ ] **Step 2: Write the failing test**

Append to `test/e2e/generate-and-run.test.ts`, after the urql test:

```ts
it('maps complex scalars through the import, declare and split input/output forms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-e2e-scalars-'));

  // Lives at the temp-dir root while the module is generated into `gql/`, so a `from` of
  // './types' — written against the config — must come out of the emitter as '../types'.
  // This is the path rewrite proven on a real filesystem, not just in path arithmetic.
  await writeFile(
    join(dir, 'types.ts'),
    'export interface Money {\n  readonly amount: number;\n  readonly currency: string;\n}\n',
  );

  const file = await generate(
    {
      schema: server.url,
      output: './gql',
      scalars: {
        Money: { name: 'Money', from: './types' },
        Metadata: {
          name: 'Metadata',
          declare: '{ readonly tags: readonly string[]; readonly views: number }',
        },
        // The wire form is a string, but an argument may also be given as epoch millis.
        Timestamp: { input: 'string | number', output: 'string' },
      },
    },
    dir,
  );

  const src = await readFile(file, 'utf8');
  expect(src).toContain("import type { Money } from '../types';");
  expect(src).toContain(
    'export type Metadata = { readonly tags: readonly string[]; readonly views: number };',
  );
  // Split positions: the result takes `output`, the argument takes `input`.
  expect(src).toContain("updatedAt: leafField<'updatedAt', ['!'], string>('updatedAt', ['!'])");
  expect(src).toContain('since?: string | number | null');

  await writeFile(file, src.replace("from 'buildql'", `from '${srcIndexPath}'`));

  const usage = join(dir, 'gql', 'usage.ts');
  await writeFile(
    usage,
    `import type { RESULT } from 'buildql';
import { query } from './index.js';
import type { Metadata } from './index.js';
import type { Money } from '../types';

export const meta = query('PostMeta', ($, Q) => [
  Q.postMeta({ id: $.id, since: $.since }, (M) => [M.id, M.metadata, M.updatedAt, M.price]),
]);

type Expect<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type MetaSelected = NonNullable<(typeof meta)[typeof RESULT]>['postMeta'];

// The declared type and the imported type must both flow all the way into the result type —
// this is the whole point of the feature, checked by tsc rather than by string matching.
export type _ResultUsesScalarTypes = Expect<
  Eq<MetaSelected, { id: string; metadata: Metadata; updatedAt: string; price: Money }>
>;

// And the split input type must reach the variables object: \`since\` accepts both forms.
type MetaVars = (typeof meta) extends { readonly __vars?: infer V } ? V : never;
export const asString = { id: 'p1', since: '2026-08-07T00:00:00.000Z' };
export const asNumber = { id: 'p1', since: 0 };
`,
  );

  await writeFile(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        paths: { buildql: [srcIndexPath] },
      },
      include: ['types.ts', 'gql/index.ts', 'gql/usage.ts'],
    }),
  );

  const tsc = new URL('../../node_modules/typescript/bin/tsc', import.meta.url).pathname;
  await expect(run(process.execPath, [tsc, '-p', join(dir, 'tsconfig.json')])).resolves.toBeTruthy();

  type MetaResult = {
    postMeta: {
      id: string;
      metadata: { readonly tags: readonly string[]; readonly views: number };
      updatedAt: string;
      price: { readonly amount: number; readonly currency: string };
    };
  };
  const mod = (await import(pathToFileURL(usage).href)) as {
    readonly meta: Operation<MetaResult, { id: string; since?: string | number | null }>;
  };

  const client = createClient({ url: server.url });
  expect(await client.execute(mod.meta, { id: 'p1', since: 0 })).toEqual({
    postMeta: {
      id: 'p1',
      metadata: { tags: ['a', 'b'], views: 42 },
      updatedAt: '2026-08-07T00:00:00.000Z',
      price: { amount: 999, currency: 'USD' },
    },
  });
}, 60_000);
```

Note on the `MetaVars` line: if the operation type does not expose variables under an inferrable key, drop that alias and keep only the two exported literals — they already prove `since` accepts both `string` and `number` under strict `tsc`, which is the actual claim. Do not leave an unused type alias that does not compile.

- [ ] **Step 3: Run the e2e suite**

Run: `npx vitest run test/e2e`
Expected: PASS, including the two pre-existing tests and the urql test, unchanged.

- [ ] **Step 4: Commit**

```bash
git add test/e2e/fixtures/server.ts test/e2e/generate-and-run.test.ts
git commit -m "test(e2e): prove complex scalar mappings compile and round-trip"
```

---

### Task 8: Documentation

The feature is unusable if the two deployment shapes — generate-in-app vs publish-as-a-package — are not spelled out, since that is exactly what determines which form a user should reach for.

**Files:**

- Modify: `README.md` (the `scalars` line in the "Configure" block, plus a new section after "Variables")

**Interfaces:**

- Consumes: the final config shape from Tasks 1 and 3.
- Produces: no code.

---

- [ ] **Step 1: Update the Configure example**

In `README.md`, in the `defineConfig({...})` block, replace:

```js
  scalars: { DateTime: 'string', JSON: 'unknown' },
```

with:

```js
  // See "Custom scalars" below for object-typed scalars.
  scalars: { DateTime: 'string', JSON: 'unknown' },
```

- [ ] **Step 2: Add the "Custom scalars" section**

Insert this section immediately after the "Variables" section and before "Fragments, unions, directives":

````markdown
## Custom scalars

Every scalar outside GraphQL's built-in five needs an entry in `scalars`, or it generates
as `unknown` (and buildql warns, by name, when it does). The simplest entry is a raw
TypeScript type expression, used in both argument and result position:

```js
scalars: { DateTime: 'string', JSON: 'unknown' }
```

For scalars a single expression cannot express, an entry can be an object instead.

**Different types in and out.** A `DateTime` you may _pass_ as a `Date` but always _read
back_ as an ISO string:

```js
scalars: { DateTime: { input: 'string | Date', output: 'string' } }
```

**A type you already have.** `from` imports it; the generated module gets an
`import type` line, so there is no runtime dependency on that module:

```js
scalars: { Money: { name: 'Money', from: './src/types/money' } }
```

**A type declared inline.** `declare` is the right-hand side of a type alias; buildql
emits `export type <name> = ...` into the generated module, so your own code can import
the type from there too:

```js
scalars: {
  JSON: {
    name: 'JSONValue',
    declare: 'string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue }',
  },
}
```

`name` can be combined with `input`/`output` to widen one position while still importing
or declaring the type: `{ name: 'Money', from: './money', input: 'Money | string' }`.
`from` and `declare` are mutually exclusive.

### Where does `from` point?

A **package specifier** (`type-fest`, `@myorg/domain-types`) is emitted verbatim.

A **relative or absolute path** is written against _your config file_ — the same as
`schema` and `output` — and buildql rewrites it to be relative to `output`. With
`output: './src/gql'`, a `from` of `'./src/types/money'` is emitted as `'../types/money'`.
Extensions are preserved exactly as written, so `nodenext` projects can write
`'./src/types/money.js'`.

**Publishing the generated module as an npm package?** (Generating in the backend repo
during CI and shipping an SDK to your frontends is a common setup.) A relative path
points at source files that will not exist inside the published package, so use one of:

- **`declare`** — the type is inlined into the generated module. Nothing to resolve, no
  dependency to declare. This is the safest default for a published SDK.
- **a package specifier** — `from: '@myorg/domain-types'`. Resolves from inside the
  published package, provided that package is a dependency of it.

buildql prints which modules the generated file imports scalar types from, so a
mis-pointed path shows up at generate time rather than at your consumers' `tsc`.

### What buildql will refuse

The config is validated before anything is generated: an unknown key (`ouput`), a `name`
that is not a valid TypeScript identifier, `from` and `declare` together, or a `name`
with neither. It also refuses a `name` that collides with something the generated module
already binds — a schema type, an enum's `…Values`, a `…Fragment` helper — rather than
emitting a file with a duplicate identifier in it.
````

- [ ] **Step 3: Check formatting and links**

Run: `npm run format:check`
Expected: PASS. If it fails, run `npm run format` and re-check.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document object-typed scalar config and the two deployment shapes"
```

---

### Task 9: Full verification

**Files:** none — this task only runs the gates.

- [ ] **Step 1: Run the full check**

Run: `npm run check`
Expected: PASS — lint (0 warnings), format, `tsc` on both type-test projects, build, Vitest, and the type-instantiation budget (`test/perf/generated.ts` under 25,000 instantiations and 3 seconds).

- [ ] **Step 2: Confirm the perf budget did not move**

The scalar changes touch codegen, not `src/types/**`, so `npm run test:perf` should be unchanged. If it regressed, the cause is a scalar type expression reaching a generic it did not before — do not raise the budget; find the expression.

- [ ] **Step 3: Confirm default output is still byte-identical**

Run: `npx vitest run test/unit/emit.test.ts -t 'emits nothing extra when no scalar contributes a prelude'`
Expected: PASS — this is the pin on the promise that existing configs generate exactly what they generated before.

- [ ] **Step 4: Commit anything the gates changed**

```bash
git status
# If `npm run format` or a lint --fix touched files:
git add -A && git commit -m "chore: formatting after complex scalar work"
```

---

## Self-review notes

- **Spec coverage.** All four requested capabilities are implemented: import a named type (Task 1 `from` + Task 2 rewriting + Task 5 emission), separate input/output (Tasks 1 and 4), inline declaration (Tasks 1 and 5), plain strings still working (Task 1 `toMapping`, pinned byte-for-byte by the Task 5 test and re-checked in Task 9). Strict validation with per-field messages is Task 3. The publish-vs-in-repo concern is addressed by the bare-specifier rule (Task 2), the `declare` form, and the README section in Task 8.
- **Known ripple.** `IRSchema` gains a required field, so every hand-built `IRSchema` literal in the test suite needs it. Task 4 covers `test/unit/ts-types.test.ts`; Task 5 Step 1 covers the four in `test/unit/emit.test.ts`. If a subagent finds another one, add `scalarPrelude: EMPTY_SCALAR_PRELUDE` there too.
- **Naming consistency.** `resolveScalars` → `ResolvedScalars { scalars, prelude }`; `IRSchema.scalars` / `IRSchema.scalarPrelude`; `ScalarMapping { input, output }`; `ScalarImport { name, from }`; `ScalarDeclaration { name, body }`. `ScalarDeclaration.body` is deliberately not called `declare` — `declare` is the _config_ key, `body` is what the emitter splices.
- **Not in scope.** Runtime serialisation of object-shaped scalars passed as _inline_ argument literals still goes through `printValue` in `src/runtime/print.ts`, which prints unquoted GraphQL object syntax. That is correct for the common JSON-scalar server, but it has no view of the scalar's type, so a value whose keys are not valid GraphQL names cannot be printed as a literal. Passing such a value as a variable (`$.metadata`) always works, since JSON variable transport is untouched by any of this. Worth a follow-up only if it comes up in practice.
