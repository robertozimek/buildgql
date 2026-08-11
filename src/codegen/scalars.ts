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
  // Keyed by the emitted TypeScript name, valued by a description of where it came from — the
  // config's own spelling of `from`/`declare`, not the rewritten specifier `scalarPreludeBlock`
  // (in emit.ts) actually groups imports by. Two scalars naming the same type from the same
  // place is a legitimate way to share one import; naming it from two different places would
  // emit one binding and silently type the second scalar against the first one's type, so it
  // fails loudly instead — even where two different spellings of `from` would in fact resolve
  // to the same file (e.g. `'./types'` and `'./x/../types'`), which is a false positive this
  // comparison accepts on purpose: erring toward an error is safer than silently wrong output.
  const sourceOf = new Map<string, string>();
  const imports: ScalarImport[] = [];
  const declarations: ScalarDeclaration[] = [];

  // Sorted so the duplicate-name error above is deterministic about which of two colliding
  // entries it reports as the earlier one — NOT for output-byte determinism: the imports and
  // declarations this function collects are re-sorted by module and by name in
  // `scalarPreludeBlock` (emit.ts) before being emitted, so `Object.keys` order never reaches
  // the generated bytes.
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
          `buildgql: two scalars both map to a TypeScript type named "${entry.name}", from different ` +
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
