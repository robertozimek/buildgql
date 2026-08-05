import { createSchema, createYoga } from 'graphql-yoga';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const typeDefs = /* GraphQL */ `
  type Query {
    posts: [Post!]!
    post(id: ID!): Post
    postsByStatus(status: Status!): [Post!]!
    pet: Pet!
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
`;

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
        },
        Mutation: {
          createUser: (_: unknown, a: { name: string; email: string }) => ({
            id: 'u2',
            firstName: a.name,
            lastName: null,
          }),
        },
      },
    }),
    logging: false,
  });
  const server = createServer(yoga);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://localhost:${port}/graphql`,
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}
