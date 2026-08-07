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
  /**
   * A diagnostic that reaches the caller as a message rather than a thrown exception.
   * Covers two distinct cases: something degraded but the pipeline still produced output
   * (e.g. a scalar generated as `unknown`, from `generate` itself), and `main` having
   * caught a fatal error and turned it into text before returning a nonzero exit code
   * instead of letting it propagate. The two are not distinguishable through this call —
   * `main`'s return value is the actual pass/fail signal; this is only ever the message
   * that goes with it.
   */
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
