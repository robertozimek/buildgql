# buildql

Type-safe GraphQL query builder, generated from your schema's introspection.

Write selections as plain TypeScript. Result types and operation variables are
both **inferred from what you selected** — no hand-written response types, no
`$name: String!` declarations.

```ts
import { query, mutation, $, createClient } from './src/gql';

const client = createClient({ url: 'https://api.example.com/graphql' });

const Posts = query('Posts', ($, Q) => [
  Q.posts((P) => [
    P.id,
    P.title,
    P.author((A) => [A.id, A.firstName, A.lastName]),
  ]),
]);

const result = await client.execute(Posts);
//    ^? { posts: { id: string; title: string; author: { id: string; firstName: string; lastName: string | null } }[] }
```

Mutations infer their variables from where you used `$`:

```ts
const CreateNewUser = mutation('CreateNewUser', ($, M) => [
  M.createUser({ name: $.name, email: $.email }, (U) => [U.id, U.firstName]),
]);

await client.execute(CreateNewUser, { name: 'John Smith', email: 'john@smith.com' });
//                                   ^ typed as { name: string; email: string }
```

`./src/gql` above is the generated module — see **Configure** below. `query`,
`mutation`, `$`, `v`, `on`, `spread`, `include`, `skip` and `createClient` are all
re-exported from it, so everyday code only needs that one import.

## Install

```bash
npm i buildql
```

## Configure

Create `buildql.config.mjs` — this works on **every** supported Node version,
including Node 20 in CI:

```js
import { defineConfig } from 'buildql/config';

export default defineConfig({
  // a URL...
  schema: 'https://api.example.com/graphql',
  headers: { Authorization: `Bearer ${process.env.API_TOKEN}` },

  // ...or a local file: './schema.graphql' or './introspection.json'

  output: './src/gql',
  scalars: { DateTime: 'string', JSON: 'unknown' },
});
```

If you'd rather write `buildql.config.ts` for the editor type-checking on
`defineConfig(...)`, that works too — but only on **Node >= 22.6 run with
`--experimental-strip-types`, or Node >= 23.6** (where native TypeScript
support is unflagged). On older Node, buildql falls back to any
`buildql.config.mjs`/`buildql.config.js` also present; if none is present it
fails with an error telling you to add one or upgrade Node.

Then:

```bash
npx buildql generate
```

## Variables

`$.someArg` marks an argument as a variable. The variable is **named after the
argument** and typed from the schema:

```ts
M.createUser({ name: $.name }, (U) => [U.id]);
// -> mutation ($name: String!) { createUser(name: $name) { id } }
```

Two fields needing different variables for the same argument name would collide.
Name one explicitly with `v()`:

```ts
import { v } from './src/gql';
Q.post({ id: v('postId') }, (P) => [P.title]);
```

Optional schema arguments produce optional variables — TypeScript handles the rest.

Enum arguments passed as literals print unquoted (`status: PUBLISHED`, not
`status: "PUBLISHED"`), *except* when the enum is nested inside an input-object
literal (e.g. `{ filter: { status: 'PUBLISHED' } }`) — the printer has no view of
the input type graph at that depth, so it falls back to a quoted string there. If
you hit this, pass the value as a variable instead (`{ filter: $.filter }`); JSON
variable transport encodes enums correctly regardless of nesting.

## Fragments, unions, directives

```ts
import { on, spread, include, v, userFragment } from './src/gql';

const NameBits = userFragment('NameBits', (U) => [U.firstName, U.lastName]);

query('Feed', ($, Q) => [
  Q.users((U) => [U.id, spread(NameBits)]),
  Q.pet((P) => [
    on('Dog', Dog, (D) => [D.breed]),
    on('Cat', Cat, (C) => [C.lives]),
  ]),
  Q.me((M) => [include(M.email, v('withEmail'))]),
]);
```

`on()` yields a discriminated union that narrows on `__typename`.
`include()`/`skip()` make the result field optional, and their condition must be a
literal `boolean` or `v('name')` — `$.name` cannot name a directive condition,
since directives have no argument key to take the name from.

## Subscriptions

```ts
import { createClient, sseTransport } from 'buildql/client';

const client = createClient({
  url: 'https://api.example.com/graphql',
  subscriptions: sseTransport({ url: 'https://api.example.com/graphql' }),
});

for await (const msg of client.subscribe(Messages)) {
  console.log(msg);
}
```

`wsTransport()` speaks the `graphql-ws` protocol if your server uses WebSockets.
Per-subscription `headers` (the third argument to `client.subscribe`) are honoured
by `sseTransport` but **cannot** be sent by `wsTransport` — the WebSocket API has no
per-message header mechanism. Authenticate WebSocket subscriptions via
`connectionParams` instead, which travels in the `connection_init` message body.
The generated module only exports `subscription` when your schema declares a
`Subscription` root type — build subscription operations with it the same way
you build queries and mutations with `query`/`mutation`.

## Requirements

- TypeScript **>= 5.4** with `"strict": true`
- Node **>= 18** to install and run the generated client/CLI in general.
  Loading a **`.ts`** config file specifically needs Node's native TypeScript
  support: **>= 22.6 with `--experimental-strip-types`, or >= 23.6**. Use
  `buildql.config.mjs` (see **Configure** above) if you're on an older Node —
  it works everywhere Node >= 18 does.
- `graphql` only if you point `schema` at an SDL file — URL and `.json`
  introspection sources need no extra dependency

## License

MIT
