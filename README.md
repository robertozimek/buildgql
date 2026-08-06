# buildql

Type-safe GraphQL query builder, generated from your schema's introspection.

Write selections as plain TypeScript. Result types and operation variables are
both **inferred from what you selected** — no hand-written response types, no
`$name: String!` declarations.

```ts
import { query, mutation, $, createClient } from './src/gql';

const client = createClient({ url: 'https://api.example.com/graphql' });

const Posts = query('Posts', ($, q) => [
  q.posts((post) => [
    post.id,
    post.title,
    post.author((author) => [author.id, author.firstName, author.lastName]),
  ]),
]);

const result = await client.execute(Posts);
//    ^? { posts: { id: string; title: string; author: { id: string; firstName: string; lastName: string | null } }[] }
```

Mutations infer their variables from where you used `$`:

```ts
const CreateNewUser = mutation('CreateNewUser', ($, m) => [
  m.createUser({ name: $.name, email: $.email }, (user) => [user.id, user.firstName]),
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

  // 'buildql' (default) | 'apollo' | 'urql' | 'none' — see "Using Apollo or urql"
  client: 'buildql',
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
m.createUser({ name: $.name }, (user) => [user.id]);
// -> mutation ($name: String!) { createUser(name: $name) { id } }
```

Two fields needing different variables for the same argument name would collide.
Name one explicitly with `v()`:

```ts
import { v } from './src/gql';
q.post({ id: v('postId') }, (post) => [post.title]);
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

const NameBits = userFragment('NameBits', (user) => [user.firstName, user.lastName]);

query('Feed', ($, q) => [
  q.users((user) => [user.id, spread(NameBits)]),
  q.pet((pet) => [
    on('Dog', Dog, (dog) => [dog.breed]),
    on('Cat', Cat, (cat) => [cat.lives]),
  ]),
  q.me((me) => [include(me.email, v('withEmail'))]),
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

## Using Apollo or urql

buildql's own `createClient` is the default, but the generated operations are just
documents plus inferred types — they run through any GraphQL client. Set `client`
in your config and the generated module re-exports that client's adapter instead
of `createClient`:

```js
export default defineConfig({
  schema: 'https://api.example.com/graphql',
  client: 'apollo', // or 'urql'
});
```

**Apollo Client:**

```ts
import { query, mutation, apolloDocument, toApolloQuery, toApolloMutation } from './src/gql';
import { useQuery } from '@apollo/client';

const UserById = query('UserById', ($, q) => [
  q.user({ id: $.id }, (user) => [user.id, user.firstName]),
]);
const CreateUser = mutation('CreateUser', ($, m) => [
  m.createUser({ name: $.name }, (user) => [user.id]),
]);

// Imperative API — the adapter returns Apollo's options object verbatim.
const { data } = await apolloClient.query(toApolloQuery(UserById, { id: '7' }));
//      ^? { user: { id: string; firstName: string } }

await apolloClient.mutate(toApolloMutation(CreateUser, { name: 'Ada' }));

// Hooks take the document positionally, so pass `apolloDocument(...)`.
const { data: hookData } = useQuery(apolloDocument(UserById), { variables: { id: '7' } });
```

`toApolloQuery` also covers `client.watchQuery()` and `client.subscribe()`, which
take the same `{ query, variables }` shape. Passing a mutation to `toApolloQuery`
(or a query to `toApolloMutation`) throws — Apollo keys those options differently.

**urql:**

```ts
import { query, mutation, toUrqlArgs, urqlDocument } from './src/gql';
import { useQuery, useMutation } from 'urql';

const UserById = query('UserById', ($, q) => [
  q.user({ id: $.id }, (user) => [user.id, user.firstName]),
]);
const CreateUser = mutation('CreateUser', ($, m) => [
  m.createUser({ name: $.name }, (user) => [user.id]),
]);

// urql's useQuery/useSubscription take { query, variables }; useMutation and the
// positional client methods take the document on its own — use urqlDocument for those.
const [result] = useQuery(toUrqlArgs(UserById, { id: '7' }));
//     ^? { data?: { user: { id: string; firstName: string } } }

const [, createUser] = useMutation(urqlDocument(CreateUser));
await urqlClient.query(urqlDocument(UserById), { id: '7' }).toPromise();
```

Every adapter is built on a `TypedDocumentNode<Result, Variables>` — the same phantom-typed
node Apollo and urql already understand. `apolloDocument`/`urqlDocument` return one directly;
`toApolloQuery`/`toApolloMutation`/`toUrqlArgs` return a `{ query, variables }` (or
`{ mutation, variables }`) object whose document field is one — so `data` and `variables` are
typed end-to-end with no extra generics at the call site.

Variables follow the same rule as `client.execute`: required schema arguments make the
`vars` argument mandatory, all-optional ones make it omissible.

You can also import the adapters directly without touching your config:

```ts
import { toApolloQuery } from 'buildql/adapters/apollo';
import { toUrqlArgs } from 'buildql/adapters/urql';
```

Adapters need the `graphql` package installed — they parse the printed document into
the AST these clients require. If it isn't installed, the import fails with Node's
`ERR_MODULE_NOT_FOUND` (`Cannot find package 'graphql'`) rather than a `buildql:` message
— the adapters import it statically so the adapter functions can stay synchronous. Setting
`client: 'none'` binds no client at all, if you want to wire one up yourself.

## Relay

Relay is **not** supported, and no adapter is planned.

Relay's store does not consume GraphQL documents at runtime. It requires
`ConcreteRequest` artifacts emitted ahead of time by relay-compiler — a normalization
AST, hashed identifiers, and a fragment-per-component model that the compiler derives
from source files it has scanned. buildql builds its documents at runtime from
TypeScript selections, so there is nothing for relay-compiler to read and nothing for
the store to normalize against.

If you use Relay, use its own compiler. buildql and Relay solve the same problem in
incompatible ways.

## Requirements

- TypeScript **>= 5.4** with `"strict": true`
- Node **>= 18** to install and run the generated client/CLI in general.
  Loading a **`.ts`** config file specifically needs Node's native TypeScript
  support: **>= 22.6 with `--experimental-strip-types`, or >= 23.6**. Use
  `buildql.config.mjs` (see **Configure** above) if you're on an older Node —
  it works everywhere Node >= 18 does.
- `graphql` if you point `schema` at an SDL file, **or** if you use an Apollo/urql
  adapter (`client: 'apollo' | 'urql'`, or a direct `buildql/adapters/*` import) —
  the adapters parse the printed document into the AST those clients expect. URL and
  `.json` introspection sources with the default client need no extra dependency.

## License

MIT
