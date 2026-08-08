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
