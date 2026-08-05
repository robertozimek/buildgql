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
    posts: { id: string; title: string; author: { id: string; firstName: string; lastName: string | null } }[];
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
