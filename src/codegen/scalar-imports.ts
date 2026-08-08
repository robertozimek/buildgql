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
