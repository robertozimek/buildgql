import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { CLIENT_EMITS } from '../codegen/clients.js';
import { emit } from '../codegen/emit.js';
import { buildIR } from '../codegen/ir.js';
import { loadSchema } from '../codegen/introspect.js';
import { toOutputRelativeSpecifier } from '../codegen/scalar-imports.js';
import { resolveScalars } from '../codegen/scalars.js';
import { unmappedScalars } from '../codegen/ts-types.js';
import { resolveOutputDir } from './config.js';
import type { BuildQLConfig } from './config.js';
import { consoleReporter } from './reporter.js';
import type { Reporter } from './reporter.js';

/** A URL is passed through untouched; a relative path resolves against `cwd`. */
function resolveSchemaSource(schema: string, cwd: string): string {
  if (/^https?:\/\//.test(schema)) return schema;
  return isAbsolute(schema) ? schema : resolve(cwd, schema);
}

/** Runs the full pipeline and returns the path of the file written. */
export async function generate(
  config: BuildQLConfig,
  cwd: string,
  reporter: Reporter = consoleReporter,
): Promise<string> {
  const schema = await loadSchema(resolveSchemaSource(config.schema, cwd), { headers: config.headers });

  // `dir` is computed before the IR, not after: a relative `scalars[...].from` is written
  // against the config file and has to be re-expressed against the directory the generated
  // module actually lands in, which only `resolveOutputDir` knows.
  const dir = resolveOutputDir(config, cwd);
  const scalars = resolveScalars(config.scalars, (from) => toOutputRelativeSpecifier(from, cwd, dir));
  const ir = buildIR(schema, scalars);

  const unmapped = unmappedScalars(ir);
  if (unmapped.length > 0) {
    reporter.warn(
      `buildql: unmapped custom scalar${unmapped.length > 1 ? 's' : ''}: ${unmapped.join(', ')} — ` +
        `generated as \`unknown\`. Add ${unmapped.length > 1 ? 'them' : 'it'} to "scalars" in your buildql.config.* for real types.`,
    );
  }

  if (scalars.prelude.imports.length > 0) {
    const modules = [...new Set(scalars.prelude.imports.map((i) => i.from))].sort();
    reporter.info(
      `buildql: the generated module imports scalar types from ${modules.join(', ')} ` +
        `(relative specifiers are resolved against your config file, then rewritten against "output")`,
    );
  }

  const client = config.client ?? 'buildql';
  const { module, names } = CLIENT_EMITS[client];
  if (module && module !== 'buildql') {
    reporter.info(
      `buildql: client "${client}" — the generated module re-exports ${names.join(', ')} ` +
        `from ${module} (requires the "graphql" package)`,
    );
  }

  const src = emit(ir, client);

  await mkdir(dir, { recursive: true });
  const file = join(dir, 'index.ts');
  await writeFile(file, src, 'utf8');
  return file;
}
