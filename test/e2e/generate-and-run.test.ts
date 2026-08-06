import { afterAll, beforeAll, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { generate } from '../../src/cli/index.js';
import { createClient } from '../../src/client/client.js';
import type { Operation } from '../../src/index.js';
import { startServer } from './fixtures/server.js';

const run = promisify(execFile);

let server: Awaited<ReturnType<typeof startServer>>;
let genDir: string;
let genFile: string;
let usageFile: string;

// The generated `index.ts` imports from the package name `buildql`, which is not
// resolvable from a throwaway temp directory. Point it at this project's own
// `src/index.ts` instead, so both `tsc` and Vitest's runtime `import()` can find it.
const srcIndexPath = new URL('../../src/index.ts', import.meta.url).pathname;

beforeAll(async () => {
  server = await startServer();
  genDir = await mkdtemp(join(tmpdir(), 'buildql-e2e-'));
  genFile = await generate({ schema: server.url, output: '.' }, genDir);

  // Only the runtime import (the first `from 'buildql'`) needs patching: the
  // trailing `export type { Operation } from 'buildql'` is a type-only re-export
  // that is fully erased at runtime, so it never needs to resolve for the dynamic
  // `import()` in the second test below. It still needs to resolve for `tsc`,
  // though — that is what the `paths` mapping in the temp tsconfig is for.
  const patched = (await readFile(genFile, 'utf8')).replace("from 'buildql'", `from '${srcIndexPath}'`);
  await writeFile(genFile, patched);

  usageFile = join(genDir, 'usage.ts');
  await writeFile(
    usageFile,
    `import type { RESULT } from 'buildql';
import { query, mutation, on, Dog, Cat } from './index.js';

export const q = query('Posts', ($, Q) => [
  Q.posts((P) => [P.id, P.title, P.author((A) => [A.id, A.firstName, A.lastName])]),
]);

export const m = mutation('CreateNewUser', ($, M) => [
  M.createUser({ name: $.name, email: $.email }, (U) => [U.id, U.firstName]),
]);

// \`P.__typename\` is selected alongside the \`on()\` inline fragments on purpose: this
// is the C1 regression case. If the emitter ever again types a union's __typename as
// its own abstract name (e.g. 'Pet') instead of the union of its possible types
// ('Dog' | 'Cat'), \`Selected\` collapses this whole branch to \`never\` and the
// assertion below fails to compile under the strict \`tsc\` run in the first test.
export const p = query('Pet', ($, Q) => [
  Q.pet((P) => [P.__typename, on('Dog', Dog, (D) => [D.breed]), on('Cat', Cat, (C) => [C.lives])]),
]);

type Expect<T extends true> = T;
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type PetSelected = NonNullable<(typeof p)[typeof RESULT]>['pet'];
export type _PetDiscriminates = Expect<
  Eq<PetSelected, { __typename: 'Dog'; breed: string } | { __typename: 'Cat'; lives: number }>
>;

// Inline enum literal argument — the emitted document must contain \`status: PUBLISHED\`
// unquoted, proving the Task 15 enum-arg codegen works end-to-end against a real server.
export const s = query('PostsByStatus', ($, Q) => [
  Q.postsByStatus({ status: 'PUBLISHED' }, (P) => [P.id, P.title, P.status]),
]);
`,
  );

  await writeFile(
    join(genDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        paths: { buildql: [srcIndexPath] },
      },
      include: ['index.ts', 'usage.ts'],
    }),
  );
}, 30_000);

afterAll(async () => {
  await server.stop();
});

it('generates a module that type-checks under strict mode', async () => {
  const tsc = new URL('../../node_modules/typescript/bin/tsc', import.meta.url).pathname;
  await expect(run(process.execPath, [tsc, '-p', join(genDir, 'tsconfig.json')])).resolves.toBeTruthy();
}, 60_000);

it('executes generated operations against the real server, including an unquoted enum literal', async () => {
  type PostsResult = {
    posts: {
      id: string;
      title: string;
      author: { id: string; firstName: string; lastName: string | null };
    }[];
  };
  type CreateUserResult = { createUser: { id: string; firstName: string } };
  type PetResult = { pet: { __typename: 'Dog'; breed: string } | { __typename: 'Cat'; lives: number } };
  type StatusResult = { postsByStatus: { id: string; title: string; status: 'DRAFT' | 'PUBLISHED' }[] };

  // The generated module is loaded dynamically, so its types are not statically
  // available here. A single `as` narrows it against the shape the first test
  // just proved the emitter actually produces — no `any`, no `as unknown as`.
  const mod = (await import(pathToFileURL(usageFile).href)) as {
    readonly q: Operation<PostsResult, {}>;
    readonly m: Operation<CreateUserResult, { name: string; email: string }>;
    readonly p: Operation<PetResult, {}>;
    readonly s: Operation<StatusResult, {}>;
  };

  const client = createClient({ url: server.url });

  const posts = await client.execute(mod.q);
  expect(posts).toEqual({
    posts: [
      { id: 'p1', title: 'Hello', author: { id: 'u1', firstName: 'Ada', lastName: null } },
      { id: 'p2', title: 'Draft one', author: { id: 'u1', firstName: 'Ada', lastName: null } },
    ],
  });

  const created = await client.execute(mod.m, { name: 'John Smith', email: 'john@smith.com' });
  expect(created).toEqual({ createUser: { id: 'u2', firstName: 'John Smith' } });

  const petResult = await client.execute(mod.p);
  expect(petResult).toEqual({ pet: { __typename: 'Dog', breed: 'Corgi' } });
  // Runtime narrowing proof to match the compile-time one in usage.ts: `__typename`
  // must actually work as a discriminant on the value the server returned, not just
  // in the type system.
  const pet = petResult.pet;
  expect(pet.__typename === 'Dog' ? pet.breed : `not a Dog: ${pet.__typename}`).toBe('Corgi');

  // The enum literal proof: the printed document carries the bare enum name, not a
  // quoted string, and the server accepts it and returns the filtered result.
  expect(mod.s.document).toContain('status: PUBLISHED');
  expect(mod.s.document).not.toContain('"PUBLISHED"');
  const byStatus = await client.execute(mod.s);
  expect(byStatus).toEqual({ postsByStatus: [{ id: 'p1', title: 'Hello', status: 'PUBLISHED' }] });
}, 60_000);

it('generates a urql-bound module that type-checks under strict mode and runs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'buildql-e2e-urql-'));
  const file = await generate({ schema: server.url, output: '.', client: 'urql' }, dir);

  // Neither `buildql` nor `buildql/adapters/urql` resolves from a throwaway temp
  // directory, so both runtime imports are rewritten to this project's own sources. The
  // two quoted specifiers are distinct strings, so a single `.replace` each is enough and
  // the order between them does not matter. As in the default-client case above, the
  // trailing type-only `export type { Operation } from 'buildql'` is erased at runtime and
  // is resolved for `tsc` by the `paths` mapping below instead.
  const adapterPath = new URL('../../src/adapters/urql.ts', import.meta.url).pathname;
  const patched = (await readFile(file, 'utf8'))
    .replace("from 'buildql/adapters/urql'", `from '${adapterPath}'`)
    .replace("from 'buildql'", `from '${srcIndexPath}'`);
  await writeFile(file, patched);

  const urqlUsageFile = join(dir, 'usage.ts');
  await writeFile(
    urqlUsageFile,
    `import { query, toUrqlArgs, urqlDocument } from './index.js';

export const q = query('Posts', ($, Q) => [Q.posts((P) => [P.id, P.title])]);

// \`postsByStatus(status: Status!)\` is required in the fixture schema, so this operation
// has a required \`status\` variable of the generated \`Status\` union.
export const byStatus = query('PostsByStatus', ($, Q) => [
  Q.postsByStatus({ status: $.status }, (P) => [P.id, P.title, P.status]),
]);

export const withVars = toUrqlArgs(byStatus, { status: 'PUBLISHED' });
export const noVars = toUrqlArgs(q);
export const doc = urqlDocument(q);

// The adapter must carry the INFERRED variables through, not widen them to a record —
// a plain DocumentNode would still compile everywhere else in this file.
export const status: 'DRAFT' | 'PUBLISHED' = withVars.variables.status;

// @ts-expect-error the operation declares a required \`status\` variable
toUrqlArgs(byStatus);
// @ts-expect-error wrong variable type
toUrqlArgs(byStatus, { status: 'ARCHIVED' });
`,
  );

  await writeFile(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        paths: { buildql: [srcIndexPath] },
      },
      include: ['index.ts', 'usage.ts'],
    }),
  );

  const tsc = new URL('../../node_modules/typescript/bin/tsc', import.meta.url).pathname;
  await expect(run(process.execPath, [tsc, '-p', join(dir, 'tsconfig.json')])).resolves.toBeTruthy();

  type PostsResult = { posts: { id: string; title: string }[] };
  type ByStatusResult = { postsByStatus: { id: string; title: string; status: 'DRAFT' | 'PUBLISHED' }[] };

  const mod = (await import(pathToFileURL(urqlUsageFile).href)) as {
    readonly q: Operation<PostsResult, {}>;
    readonly byStatus: Operation<ByStatusResult, { status: 'DRAFT' | 'PUBLISHED' }>;
    readonly withVars: {
      query: { kind: string; definitions: readonly unknown[] };
      variables: { status: string };
    };
    readonly noVars: { query: { kind: string }; variables: Record<string, never> };
    readonly doc: { kind: string };
  };

  // The adapter produced a real parsed AST, and the same one for the same operation.
  expect(mod.noVars.query.kind).toBe('Document');
  expect(mod.doc).toBe(mod.noVars.query);
  expect(mod.noVars.variables).toEqual({});
  expect(mod.withVars.variables).toEqual({ status: 'PUBLISHED' });
  expect(mod.withVars.query.definitions).toHaveLength(1);

  // The generated module binds urql and NOT buildql's own client.
  const generated = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  expect(typeof generated.toUrqlArgs).toBe('function');
  expect(typeof generated.urqlDocument).toBe('function');
  expect(generated.createClient).toBeUndefined();

  // The document the adapter handed to urql is still the one the server accepts —
  // executing it through buildql's client proves the adapter changed nothing but the form.
  const client = createClient({ url: server.url });
  expect(await client.execute(mod.byStatus, { status: 'PUBLISHED' })).toEqual({
    postsByStatus: [{ id: 'p1', title: 'Hello', status: 'PUBLISHED' }],
  });
}, 60_000);
