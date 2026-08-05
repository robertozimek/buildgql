/** Keys of `V` that are not optional. */
export type RequiredKeys<V> = { [K in keyof V]-?: {} extends Pick<V, K> ? never : K }[keyof V];

/** True when the operation declared at least one REQUIRED variable — an all-optional
 *  variable map (e.g. `{ after?: string }`) must not force a positional `vars` argument. */
export type HasVars<V> = RequiredKeys<V> extends never ? false : true;

/**
 * The trailing parameter list carrying an operation's variables, and nothing else.
 * `NoInfer` stops `V` being re-inferred from the argument, which would otherwise let a
 * pre-declared object with missing keys through silently.
 *
 * `client.execute`/`client.subscribe` need a second `ExecuteOptions` slot as well, so they
 * build their own tuple from `HasVars` rather than using this alias — see `client.ts`.
 */
export type VarsArg<V> = HasVars<V> extends true ? [vars: NoInfer<V>] : [vars?: NoInfer<V>];
