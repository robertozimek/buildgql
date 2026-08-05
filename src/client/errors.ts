export interface GraphQLFormattedError {
  readonly message: string;
  readonly path?: readonly (string | number)[];
  readonly locations?: readonly { line: number; column: number }[];
  readonly extensions?: Record<string, unknown>;
}

/** The server answered 2xx but the payload contained `errors`. */
export class GraphQLResponseError extends Error {
  readonly errors: readonly GraphQLFormattedError[];
  readonly data: unknown;

  constructor(errors: readonly GraphQLFormattedError[], data: unknown) {
    super(`buildql: ${errors.map((e) => e.message).join('; ') || 'GraphQL request failed'}`);
    this.name = 'GraphQLResponseError';
    this.errors = errors;
    this.data = data;
  }
}

/** The transport failed — non-2xx status or an unparseable body. */
export class BuildQLHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`buildql: GraphQL request failed with HTTP ${status}`);
    this.name = 'BuildQLHttpError';
    this.status = status;
    this.body = body;
  }
}
