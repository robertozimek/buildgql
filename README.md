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

Contributing? See [CONTRIBUTING.md](./CONTRIBUTING.md) for the naming, error, and
type-performance conventions this repo follows — `npm run check` enforces what's
mechanical (case shape, the `any` ban, the type-instantiation budget); the rest is
convention enforced by review.

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
  // See "Custom scalars" below for object-typed scalars.
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
`status: "PUBLISHED"`), _except_ when the enum is nested inside an input-object
literal (e.g. `{ filter: { status: 'PUBLISHED' } }`) — the printer has no view of
the input type graph at that depth, so it falls back to a quoted string there. If
you hit this, pass the value as a variable instead (`{ filter: $.filter }`); JSON
variable transport encodes enums correctly regardless of nesting.

## Custom scalars

Every scalar outside GraphQL's built-in five (`ID`, `String`, `Int`, `Float`, `Boolean`)
needs an entry in `scalars`, or it generates as `unknown` (and buildql warns, by name,
when it does). The simplest entry is a raw TypeScript type expression, used in both
argument and result position:

```js
scalars: { DateTime: 'string', JSON: 'unknown' }
```

For scalars a single expression cannot express, an entry can be an object instead.

**Different types in and out.** A `DateTime` you may _pass_ as a `Date` but always _read
back_ as an ISO string:

```js
scalars: { DateTime: { input: 'string | Date', output: 'string' } }
```

**A type you already have.** `from` imports it; the generated module gets an
`import type` line, so there is no runtime dependency on that module:

```js
scalars: { Money: { name: 'Money', from: './src/types/money' } }
```

**A type declared inline.** `declare` is the right-hand side of a type alias; buildql
emits `export type <name> = ...` into the generated module, so your own code can import
the type from there too:

```js
scalars: {
  JSON: {
    name: 'JSONValue',
    declare: 'string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue }',
  },
}
```

`name` can be combined with `input`/`output` to widen one position while still importing
or declaring the type: `{ name: 'Money', from: './money', input: 'Money | string' }`.
`from` and `declare` are mutually exclusive.

### Where does `from` point?

A **package specifier** (`type-fest`, `@myorg/domain-types`) is emitted verbatim.

A **relative or absolute path** is written against _your config file_ — the same as
`schema` and `output` — and buildql rewrites it to be relative to `output`. With
`output: './src/gql'`, a `from` of `'./src/types/money'` is emitted as `'../types/money'`.
Extensions are preserved exactly as written, so `nodenext` projects can write
`'./src/types/money.js'`.

**Publishing the generated module as an npm package?** (Generating in the backend repo
during CI and shipping an SDK to your frontends is a common setup.) A relative path
points at source files that will not exist inside the published package, so use one of:

- **`declare`** — the type is inlined into the generated module. Nothing to resolve, no
  dependency to declare. This is the safest default for a published SDK.
- **a package specifier** — `from: '@myorg/domain-types'`. Resolves from inside the
  published package, provided that package is a dependency of it.

buildql prints which modules the generated file imports scalar types from, so a
mis-pointed path shows up at generate time rather than at your consumers' `tsc`.

### What buildql will refuse

The config is validated before anything is generated: an unknown key (`ouput`), a `name`
that isn't a bare identifier (ASCII letters/digits/`_`/`$`, not starting with a digit —
this is a character-shape check, not a reserved-word check, so `name: 'default'` still
gets through and only fails once TypeScript compiles the generated file), `from` and
`declare` together, or `name` and `from`/`declare` used without one another — a `name`
with neither, or a `from`/`declare` with no `name` to hang it on. It also refuses a `name`
that collides with something the generated module already binds — a schema type, an
enum's `…Values`, a `…Fragment` helper — rather than emitting a file with a duplicate
identifier in it.

## Fragments, unions, directives

```ts
import { on, spread, include, v, userFragment } from './src/gql';

const NameBits = userFragment('NameBits', (user) => [user.firstName, user.lastName]);

query('Feed', ($, q) => [
  q.users((user) => [user.id, spread(NameBits)]),
  q.pet((pet) => [on('Dog', Dog, (dog) => [dog.breed]), on('Cat', Cat, (cat) => [cat.lives])]),
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

const UserById = query('UserById', ($, q) => [q.user({ id: $.id }, (user) => [user.id, user.firstName])]);
const CreateUser = mutation('CreateUser', ($, m) => [m.createUser({ name: $.name }, (user) => [user.id])]);

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

const UserById = query('UserById', ($, q) => [q.user({ id: $.id }, (user) => [user.id, user.firstName])]);
const CreateUser = mutation('CreateUser', ($, m) => [m.createUser({ name: $.name }, (user) => [user.id])]);

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

### Known limitation: `noUncheckedIndexedAccess`

`$.argName` does not type-check in projects that enable TypeScript's
`noUncheckedIndexedAccess`. The `$` proxy is typed as an index signature, so under that
flag every read widens to `VarMarker | undefined`, which the argument types reject.

Use the explicit form instead — it is unaffected:

```ts
import { v } from 'buildql';

const UserById = query('UserById', ($, q) => [q.user({ id: v('id') }, (user) => [user.name])]);
```

## License

MIT
