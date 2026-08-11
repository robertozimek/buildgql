import { GraphQLScalarType } from 'graphql';
import { createSchema, createYoga } from 'graphql-yoga';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const typeDefs = /* GraphQL */ `
  type Query {
    posts: [Post!]!
    post(id: ID!): Post
    postsByStatus(status: Status!): [Post!]!
    pet: Pet!
    postMeta(id: ID!, since: Timestamp): PostMeta!
  }
  type Mutation {
    createUser(name: String!, email: String!, age: Int): User!
  }
  type Post {
    id: ID!
    title: String!
    author: User!
    status: Status!
  }
  enum Status {
    DRAFT
    PUBLISHED
  }
  type User {
    id: ID!
    firstName: String!
    lastName: String
  }
  union Pet = Dog | Cat
  type Dog {
    name: String!
    breed: String!
  }
  type Cat {
    name: String!
    lives: Int!
  }
  type PostMeta {
    id: ID!
    metadata: Metadata!
    updatedAt: Timestamp!
    price: Money!
  }
  scalar Money
  scalar Metadata
  scalar Timestamp
`;

/**
 * A custom scalar that transports its JSON value untouched. Enough for a codegen end-to-end:
 * what is under test is the *types* buildgql generates for a scalar, not the server's coercion.
 * `parseLiteral` is left at its default (`valueFromASTUntyped`), which already handles object
 * and list literals.
 */
function passthroughScalar(name: string): GraphQLScalarType {
  return new GraphQLScalarType({ name, serialize: (v: unknown) => v, parseValue: (v: unknown) => v });
}

const users = [{ id: 'u1', firstName: 'Ada', lastName: null }];
const posts = [
  { id: 'p1', title: 'Hello', author: users[0], status: 'PUBLISHED' },
  { id: 'p2', title: 'Draft one', author: users[0], status: 'DRAFT' },
];

export async function startServer(): Promise<{ url: string; stop: () => Promise<void> }> {
  const yoga = createYoga({
    schema: createSchema({
      typeDefs,
      resolvers: {
        Query: {
          posts: () => posts,
          post: (_: unknown, a: { id: string }) => posts.find((p) => p.id === a.id) ?? null,
          postsByStatus: (_: unknown, a: { status: string }) => posts.filter((p) => p.status === a.status),
          pet: () => ({ __typename: 'Dog', name: 'Rex', breed: 'Corgi' }),
          postMeta: (_: unknown, a: { id: string }) => ({
            id: a.id,
            metadata: { tags: ['a', 'b'], views: 42 },
            updatedAt: '2026-08-07T00:00:00.000Z',
            price: { amount: 999, currency: 'USD' },
          }),
        },
        Mutation: {
          createUser: (_: unknown, a: { name: string; email: string }) => ({
            id: 'u2',
            firstName: a.name,
            lastName: null,
          }),
        },
        Money: passthroughScalar('Money'),
        Metadata: passthroughScalar('Metadata'),
        Timestamp: passthroughScalar('Timestamp'),
      },
    }),
    logging: false,
  });
  // graphql-yoga's server instance is a valid `http.createServer` request listener; this
  // is exactly how Yoga's own docs wire it up, even though its handler resolves asynchronously.
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  const server = createServer(yoga);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://localhost:${port}/graphql`,
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}
