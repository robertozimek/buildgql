export interface GraphQLFormattedError {
  readonly message: string;
  readonly path?: readonly (string | number)[];
  readonly locations?: readonly { line: number; column: number }[];
  readonly extensions?: Record<string, unknown>;
}

/**
 * Base class for every error buildql throws from the client. Exists so consumers can
 * write one `catch (e) { if (e instanceof BuildQLError) ... }` instead of enumerating
 * subclasses — and so adding a subclass later does not break that check.
 */
export abstract class BuildQLError extends Error {}

/** The server answered 2xx but the payload contained `errors`. */
export class BuildQLResponseError extends BuildQLError {
  readonly errors: readonly GraphQLFormattedError[];
  readonly data: unknown;

  constructor(errors: readonly GraphQLFormattedError[], data: unknown) {
    super(`buildql: ${errors.map((e) => e.message).join('; ') || 'GraphQL request failed'}`);
    // Assigned literally, not from `new.target.name`: a minifying bundler mangles
    // class names, and this string is part of the public contract.
    this.name = 'BuildQLResponseError';
    this.errors = errors;
    this.data = data;
  }
}

/** The transport failed — non-2xx status or an unparseable body. */
export class BuildQLHttpError extends BuildQLError {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`buildql: GraphQL request failed with HTTP ${status}`);
    this.name = 'BuildQLHttpError';
    this.status = status;
    this.body = body;
  }
}
