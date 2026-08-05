/** Which GraphQL client the generated module binds to. */
export type ClientKind = 'buildql' | 'apollo' | 'urql' | 'none';

export const CLIENT_KINDS = ['buildql', 'apollo', 'urql', 'none'] as const satisfies readonly ClientKind[];

export interface ClientEmit {
  /** Module the generated file imports the client bindings from. Absent for `'none'`. */
  readonly module?: string;
  /** Names imported from `module` — also exactly the names re-exported. Keep sorted. */
  readonly names: readonly string[];
}

/**
 * Single source of truth for what each client contributes to the generated module. The
 * config validator and the emitter both read it, so adding a client is a one-entry change
 * here plus an adapter module.
 */
export const CLIENT_EMITS: Record<ClientKind, ClientEmit> = {
  buildql: { module: 'buildql', names: ['createClient'] },
  apollo: {
    module: 'buildql/adapters/apollo',
    names: ['apolloDocument', 'toApolloMutation', 'toApolloQuery'],
  },
  urql: { module: 'buildql/adapters/urql', names: ['toUrqlArgs', 'urqlDocument'] },
  none: { names: [] },
};

export function isClientKind(value: unknown): value is ClientKind {
  return typeof value === 'string' && (CLIENT_KINDS as readonly string[]).includes(value);
}
