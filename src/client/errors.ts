export interface GraphQLFormattedError {
  readonly message: string;
  readonly path?: readonly (string | number)[];
  readonly locations?: readonly { line: number; column: number }[];
  readonly extensions?: Record<string, unknown>;
}

/**
 * Base class for every error buildgql throws from the client. Exists so consumers can
 * write one `catch (e) { if (e instanceof BuildGQLError) ... }` instead of enumerating
 * subclasses — and so adding a subclass later does not break that check.
 *
 * That `instanceof` holds for an error obtained from `buildgql` and one thrown through
 * `buildgql/client`, in ESM and in CJS alike: both entries reach a single copy of this
 * class through a shared chunk (`splitting: true` in `tsup.config.ts`), pinned by
 * `test/built/interop.test.ts`.
 *
 * It cannot hold across a consumer that loads BOTH the ESM and the CJS build of this
 * package — two module instances, two class objects, and `instanceof` is false between
 * them. That is inherent to dual publishing rather than a defect here, and no packaging
 * change can close it; a consumer in that position must compare `error.name` instead.
 */
export abstract class BuildGQLError extends Error {}

/** The server answered 2xx but the payload contained `errors`. */
export class BuildGQLResponseError extends BuildGQLError {
  readonly errors: readonly GraphQLFormattedError[];
  readonly data: unknown;

  constructor(errors: readonly GraphQLFormattedError[], data: unknown) {
    super(`buildgql: ${errors.map((e) => e.message).join('; ') || 'GraphQL request failed'}`);
    // Assigned literally, not from `new.target.name`: a minifying bundler mangles
    // class names, and this string is part of the public contract.
    this.name = 'BuildGQLResponseError';
    this.errors = errors;
    this.data = data;
  }
}

/** The transport failed — non-2xx status or an unparseable body. */
export class BuildGQLHttpError extends BuildGQLError {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`buildgql: GraphQL request failed with HTTP ${status}`);
    this.name = 'BuildGQLHttpError';
    this.status = status;
    this.body = body;
  }
}
