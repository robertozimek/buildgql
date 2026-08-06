#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from '../codegen/emit.js';
import { unmappedScalars } from '../codegen/ts-types.js';
import { buildIR } from '../codegen/ir.js';
import { loadSchema } from '../codegen/introspect.js';
import { CLIENT_EMITS } from '../codegen/clients.js';
import { loadConfig, resolveOutputDir } from './config.js';
import type { BuildQLConfig } from './config.js';

/** Runs the full pipeline and returns the path of the file written. */
export async function generate(config: BuildQLConfig, cwd: string): Promise<string> {
  const source = /^https?:\/\//.test(config.schema)
    ? config.schema
    : isAbsolute(config.schema)
      ? config.schema
      : resolve(cwd, config.schema);

  const schema = await loadSchema(source, { headers: config.headers });
  const ir = buildIR(schema, config.scalars);

  const unmapped = unmappedScalars(ir);
  if (unmapped.length > 0) {
    process.stderr.write(
      `buildql: unmapped custom scalar${unmapped.length > 1 ? 's' : ''}: ${unmapped.join(', ')} — ` +
        `generated as \`unknown\`. Add ${unmapped.length > 1 ? 'them' : 'it'} to "scalars" in your buildql.config.* for real types.\n`,
    );
  }

  const client = config.client ?? 'buildql';
  const { module, names } = CLIENT_EMITS[client];
  if (module && module !== 'buildql') {
    process.stdout.write(
      `buildql: client "${client}" — the generated module re-exports ${names.join(', ')} ` +
        `from ${module} (requires the "graphql" package)\n`,
    );
  }

  const src = emit(ir, client);

  const dir = resolveOutputDir(config, cwd);
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'index.ts');
  await writeFile(file, src, 'utf8');
  return file;
}

const USAGE = `buildql — type-safe GraphQL query builder codegen

Usage:
  buildql generate [--config <dir>]   Generate the SDK from buildql.config.*
  buildql --help                      Show this message
`;

export async function main(argv: string[]): Promise<number> {
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
    process.stdout.write(`buildql: using ${path}\n`);
    const out = await generate(config, cwd);
    process.stdout.write(`buildql: wrote ${out}\n`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

/**
 * True when `moduleUrl` is the module Node was actually asked to run.
 *
 * Both sides are resolved through `realpathSync` before comparing, because they arrive in
 * different forms: Node resolves `import.meta.url` to the file's REALPATH, while
 * `process.argv[1]` keeps whatever path the caller typed. Every symlinking installer —
 * pnpm by default, npm workspaces, `npm link` — puts `node_modules/buildql` behind a
 * symlink into a content-addressed store, so a raw string comparison is false for all of
 * them. The failure is silent and looks like success: `main()` never runs, nothing is
 * generated, and the process still exits 0.
 *
 * (Resolving both sides also covers macOS, where `/var` is itself a symlink to
 * `/private/var`, so even an unsymlinked temp path disagrees with its own realpath.)
 */
export function isEntrypoint(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  // A path that no longer exists must compare unequal, not throw.
  const real = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  let modulePath: string;
  try {
    modulePath = fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
  return real(modulePath) === real(argv1);
}

// Only run when invoked as the binary, not when imported by tests.
if (isEntrypoint(import.meta.url, process.argv[1])) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
