#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { emit } from '../codegen/emit.js';
import { buildIR } from '../codegen/ir.js';
import { loadSchema } from '../codegen/introspect.js';
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
  const src = emit(ir);

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
  const cwd = flagIndex !== -1 && argv[flagIndex + 1] ? resolve(argv[flagIndex + 1]!) : process.cwd();

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

// Only run when invoked as the binary, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
