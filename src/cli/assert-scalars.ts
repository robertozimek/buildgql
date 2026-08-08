import type { ScalarConfig, ScalarTypeConfig } from '../codegen/scalars.js';

/**
 * The only keys a `scalars` object entry may carry. Anything else is a typo.
 *
 * `satisfies readonly (keyof ScalarTypeConfig)[]` catches a key listed here that
 * `ScalarTypeConfig` does not declare (a typo in this array). `AllScalarKeysListed` below
 * catches the opposite drift — a key added to `ScalarTypeConfig` and forgotten here, which
 * would otherwise compile clean while the validator silently rejects the new key as unknown.
 */
const SCALAR_KEYS = [
  'name',
  'from',
  'declare',
  'input',
  'output',
] as const satisfies readonly (keyof ScalarTypeConfig)[];

/** Fails to compile if a key is added to `ScalarTypeConfig` without being added to `SCALAR_KEYS`. */
export type AllScalarKeysListed =
  Exclude<keyof ScalarTypeConfig, (typeof SCALAR_KEYS)[number]> extends never ? true : never;

/**
 * What `name` must look like to be spliced into `import type { <name> }` / `export type <name>`.
 * Deliberately ASCII-only: TypeScript accepts a far wider set of identifier characters, but a
 * `name` outside this shape is overwhelmingly a mistake, and the failure it causes otherwise —
 * a syntax error inside a generated file — is much harder to trace back to the config line.
 */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * `name` values that pass `IDENTIFIER` but still break `import type { <name> }` or
 * `export type <name> = ...` in the generated module. Verified against TypeScript 5.9
 * (`tsc --strict`), not guessed — two different reasons land a word here:
 *
 * - The ECMAScript reserved words (plus `await`, reserved at module top level, and the
 *   strict-mode future-reserved words `implements`/`interface`/`let`/`package`/`private`/
 *   `protected`/`public`/`static`/`yield` — modules are always strict) fail to parse as
 *   either an import binding or a type-alias name at all (e.g. `import type { class }`).
 * - The predefined/utility type names (`any`, `bigint`, `boolean`, `never`, `number`,
 *   `object`, `string`, `symbol`, `undefined`, `unknown`) parse fine as an import binding —
 *   TypeScript only rejects them as a type-alias name (TS2457) — but since `name` can be
 *   used with either `from` or `declare`, both are rejected here regardless of which one
 *   the entry actually sets. `null` and `void` are reserved words already covered by the
 *   first bucket above; TypeScript separately reports TS2457 for them too, so they would
 *   land in this set either way.
 */
const RESERVED_NAMES = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'await',
  'implements',
  'interface',
  'let',
  'package',
  'private',
  'protected',
  'public',
  'static',
  'yield',
  'any',
  'bigint',
  'boolean',
  'never',
  'number',
  'object',
  'string',
  'symbol',
  'undefined',
  'unknown',
]);

/**
 * `from` is spliced verbatim into `import type { <name> } from '<from>';` — a single-quoted
 * string literal, unlike `declare`/`input`/`output`, which are raw TypeScript expressions
 * the user has always been free to write however they like and which this deliberately does
 * NOT validate the same way. A `'`, `"`, or newline in `from` would break out of that literal
 * or otherwise corrupt it into a syntax error inside a file the user never wrote; backslash is
 * included because it is meaningless here on every platform that matters — even a Windows-style
 * path must use forward slashes to become a valid specifier — so rejecting it early is strictly
 * better than emitting one that could parse as an escape sequence.
 */
const UNSAFE_IN_QUOTED_SPECIFIER = /['"\n\r\\]/;

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
    if (from !== undefined) {
      assertNonEmptyString(configName, scalar, 'from', from);
      // `declare`/`input`/`output` are deliberately NOT checked this way — they are raw
      // TypeScript expressions that have always been spliced in unescaped, and quoting rules
      // do not apply to them. Only `from` lands inside a quoted string literal.
      if (UNSAFE_IN_QUOTED_SPECIFIER.test(from)) {
        throw new Error(
          `buildql: ${configName}'s "scalars.${scalar}.from" ("${from}") contains a character ` +
            `("'", '"', a backslash, or a newline) that cannot appear there — "from" is emitted ` +
            `inside a quoted module specifier. Use forward slashes even for a Windows-style path.`,
        );
      }
    }
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
      if (RESERVED_NAMES.has(name)) {
        throw new Error(
          `buildql: ${configName}'s "scalars.${scalar}.name" ("${name}") is a reserved word and cannot be ` +
            `spliced into "import type { ${name} }" or "export type ${name} = ..." — choose a different name`,
        );
      }
      if (from === undefined && declare === undefined) {
        throw new Error(
          `buildql: ${configName}'s "scalars.${scalar}" sets "name" but neither "from" nor "declare" — ` +
            `nothing in the generated module would declare that type`,
        );
      }
    } else if (from !== undefined || declare !== undefined) {
      // `from`/`declare` supplies the type's *definition*; `name` is what both the generated
      // module (`import type { <name> }` / `export type <name>`) and this scalar's own
      // `input`/`output` fallback (see `toMapping` in `codegen/scalars.ts`) refer to it by.
      // Without it there is a definition with nothing to call it, so the two are required together.
      throw new Error(
        `buildql: ${configName}'s "scalars.${scalar}" sets "${from !== undefined ? 'from' : 'declare'}" ` +
          `but not "name" — "name" is what the generated module refers to the type by`,
      );
    } else if (input === undefined && output === undefined) {
      throw new Error(
        `buildql: ${configName}'s "scalars.${scalar}" is empty — set "input"/"output", or "name" ` +
          `together with "from" or "declare"`,
      );
    }
  }
}
