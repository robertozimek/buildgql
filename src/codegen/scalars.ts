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
