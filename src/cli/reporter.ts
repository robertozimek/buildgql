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
