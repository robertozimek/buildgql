import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { generate } from './generate.js';
import { consoleReporter } from './reporter.js';
import type { Reporter } from './reporter.js';

const USAGE = `buildql — type-safe GraphQL query builder codegen

Usage:
  buildql generate [--config <dir>]   Generate the SDK from buildql.config.*
  buildql --help                      Show this message
`;

/** Parses argv, runs the requested command, and returns the process exit code. */
export async function main(argv: string[], reporter: Reporter = consoleReporter): Promise<number> {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(USAGE);
    return cmd ? 0 : 1;
  }
  if (cmd !== 'generate') {
    process.stderr.write(`buildql: unknown command "${cmd}"\n\n${USAGE}`);
    return 1;
  }

  const flagIndex = argv.indexOf('--config');
  const cwd = flagIndex !== -1 && argv[flagIndex + 1] ? resolve(argv[flagIndex + 1]) : process.cwd();

  try {
    const { config, path } = await loadConfig(cwd);
    reporter.info(`buildql: using ${path}`);
    const out = await generate(config, cwd, reporter);
    reporter.info(`buildql: wrote ${out}`);
    return 0;
  } catch (err) {
    reporter.warn(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
