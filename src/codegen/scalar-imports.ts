import {
  isAbsolute as defaultIsAbsolute,
  relative as defaultRelative,
  resolve as defaultResolve,
  sep as defaultSep,
} from 'node:path';

/**
 * Subset of `node:path` methods used by `toOutputRelativeSpecifier`, exposed purely as a
 * test seam: Windows cross-drive paths (e.g. `C:\repo` and `D:\out`) cannot be related by
 * `path.relative`, which returns the target's absolute path unchanged. This branch is
 * unreachable on POSIX (where all paths share a common root), so testing it requires
 * overriding the path module to use Windows semantics. Production code never passes this —
 * callers use the default `node:path` — so real codebases on Windows either share a drive
 * or use bare specifiers (e.g. `'@myorg/types'`) where no rewriting is needed.
 */
export interface PathModule {
  isAbsolute(path: string): boolean;
  relative(from: string, to: string): string;
  resolve(from: string, to: string): string;
  readonly sep: string;
}

/**
 * True when `spec` names a *package* rather than a file on disk — it neither starts with `.`
 * nor is absolute. Bare specifiers are emitted verbatim: when the generated module is
 * published as an npm package (generated in the backend repo, consumed by the frontend), a
 * bare specifier is the only form that still resolves from inside the published package,
 * and rewriting it against a directory layout that no longer exists would break it.
 */
export function isBareSpecifier(spec: string): boolean {
  return !spec.startsWith('.') && !defaultIsAbsolute(spec);
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
export function toOutputRelativeSpecifier(
  spec: string,
  configDir: string,
  outputDir: string,
  pathModule?: PathModule,
): string {
  const path = pathModule || {
    isAbsolute: defaultIsAbsolute,
    relative: defaultRelative,
    resolve: defaultResolve,
    sep: defaultSep,
  };
  if (isBareSpecifier(spec)) return spec;
  const target = path.resolve(configDir, spec);
  const rel = path.relative(outputDir, target).split(path.sep).join('/');
  // On Windows, when configDir and outputDir sit on different drives, `path.relative()`
  // returns the target's absolute path unchanged. That absolute path does not start with
  // `.`, so our final line would incorrectly prefix it, producing a nonsense specifier.
  // Throw instead, telling the user to use a bare specifier (e.g. `'@myorg/types'`).
  if (path.isAbsolute(rel)) {
    throw new Error(
      `buildql: cannot rewrite ${spec} for output: configDir (${configDir}) and outputDir (${outputDir}) ` +
        `have no shared base path (on Windows, they may be on different drives). ` +
        `Use a bare package specifier (e.g. '@myorg/types') or \`declare module\` instead.`,
    );
  }
  // `relative()` returns '' when the two paths are identical, and returns a bare `name` (no
  // leading `./`) for anything directly inside `outputDir` — which would read as a *package*
  // specifier, not a sibling file. Both need the explicit relative prefix put back.
  if (rel.length === 0) return '.';
  return rel.startsWith('.') ? rel : `./${rel}`;
}
