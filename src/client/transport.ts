import type { GraphQLFormattedError } from './errors.js';

export interface SubscribePayload {
  readonly query: string;
  readonly operationName: string;
  readonly variables: Record<string, unknown>;
}

export interface StreamChunk {
  readonly data?: unknown;
  readonly errors?: readonly GraphQLFormattedError[];
}

export interface SubscriptionTransport {
  /** `headers` carries per-subscription headers from `client.subscribe(op, vars, { headers })`. */
  subscribe(
    payload: SubscribePayload,
    signal: AbortSignal,
    headers?: HeadersInit,
  ): AsyncIterable<StreamChunk>;
}
