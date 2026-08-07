/** Headers, or a function producing them — evaluated per request so tokens can refresh. */
export type HeadersSource = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);

/**
 * Resolves a `HeadersSource` to a plain `HeadersInit`.
 *
 * Callers on a path where an extra microtask is acceptable should use this. `subscribe`
 * in create-client.ts deliberately does NOT — see the comment there.
 */
export async function resolveHeaders(source: HeadersSource | undefined): Promise<HeadersInit> {
  if (!source) return {};
  return typeof source === 'function' ? await source() : source;
}

/**
 * Merges `override` onto `base`, last-writer-wins per header name. Per-request headers
 * beat client-level ones everywhere in buildql; this is the single place that rule lives.
 */
export function mergeHeaders(base: HeadersInit, override?: HeadersInit): Headers {
  const headers = new Headers(base);
  for (const [name, value] of new Headers(override ?? {})) headers.set(name, value);
  return headers;
}
