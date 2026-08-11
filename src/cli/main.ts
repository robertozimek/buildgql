import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { generate } from './generate.js';
import { consoleReporter } from './reporter.js';
import type { Reporter } from './reporter.js';

const USAGE = `buildgql — type-safe GraphQL query builder codegen

Usage:
  buildgql generate [--config <dir>]   Generate the SDK from buildgql.config.*
  buildgql --help                      Show this message
  buildgql --version                   Print the version
`;

/**
 * The published version, read from the manifest rather than baked in at build time.
 *
 * `../../package.json` resolves to the package root from BOTH locations this module is
 * loaded from — `src/cli/main.ts` under test and `dist/cli/bin.js` once bundled — because
 * tsup keeps the CLI at the same depth as the source. `files` ships `dist`, and npm always
 * ships `package.json`, so the read succeeds inside an installed package too.
 *
 * Read at call time, not at module load: `bin.ts` imports this module to run ANY command,
 * and a top-level await would put a filesystem read in front of every `buildgql generate`
 * to serve a flag it did not pass.
 */
async function version(): Promise<string> {
  const manifest = new URL('../../package.json', import.meta.url);
  const { version: v } = JSON.parse(await readFile(manifest, 'utf8')) as { version?: string };
  // `??` rather than a throw: a missing version is not worth failing a CLI over, and the
  // literal is more useful in a bug report than a stack trace from the flag that prints it.
  return v ?? 'unknown';
}

/** Parses argv, runs the requested command, and returns the process exit code. */
export async function main(argv: string[], reporter: Reporter = consoleReporter): Promise<number> {
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(USAGE);
    return cmd ? 0 : 1;
  }
  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(`${await version()}\n`);
    return 0;
  }
  if (cmd !== 'generate') {
    process.stderr.write(`buildgql: unknown command "${cmd}"\n\n${USAGE}`);
    return 1;
  }

  const flagIndex = argv.indexOf('--config');
  const cwd = flagIndex !== -1 && argv[flagIndex + 1] ? resolve(argv[flagIndex + 1]) : process.cwd();

  try {
    const { config, path } = await loadConfig(cwd);
    reporter.info(`buildgql: using ${path}`);
    const out = await generate(config, cwd, reporter);
    reporter.info(`buildgql: wrote ${out}`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Errors buildgql itself throws already carry the prefix (house rule, enforced by
    // review, not by a lint rule). An unwrapped Node error crossing this boundary — a raw
    // ENOENT/EACCES from the filesystem, a rejected `fetch` — would not, so it is added
    // here rather than trusted to already be there.
    reporter.warn(message.startsWith('buildgql: ') ? message : `buildgql: ${message}`);
    return 1;
  }
}
