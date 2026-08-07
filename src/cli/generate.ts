import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { CLIENT_EMITS } from '../codegen/clients.js';
import { emit } from '../codegen/emit.js';
import { buildIR } from '../codegen/ir.js';
import { loadSchema } from '../codegen/introspect.js';
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
  const ir = buildIR(schema, config.scalars);

  const unmapped = unmappedScalars(ir);
  if (unmapped.length > 0) {
    reporter.warn(
      `buildql: unmapped custom scalar${unmapped.length > 1 ? 's' : ''}: ${unmapped.join(', ')} — ` +
        `generated as \`unknown\`. Add ${unmapped.length > 1 ? 'them' : 'it'} to "scalars" in your buildql.config.* for real types.`,
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

  const dir = resolveOutputDir(config, cwd);
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'index.ts');
  await writeFile(file, src, 'utf8');
  return file;
}
