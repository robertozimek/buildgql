import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as api from '../../src/index.js';

it('exports exactly the documented public surface', () => {
  // A deliberate tripwire, not a rubber stamp: adding or removing a runtime export is a
  // public API change, so it should require editing this list in the same commit. Type-only
  // exports (e.g. `Client`, `HeadersSource`) are erased at compile time and never appear in
  // `Object.keys` here — that's why a value export that gets demoted to `export type` also
  // trips this check: it silently disappears from this list, same as an outright removal.
  // The type-only export names this test can't see are separately locked, against BUILT
  // output, by test/built/type-surface.test.ts.
  expect(Object.keys(api).sort()).toEqual(
    [
      'BuildGQLError',
      'BuildGQLHttpError',
      'BuildGQLResponseError',
      'VERSION',
      '$',
      'argSpec',
      'createClient',
      'include',
      'leafField',
      'leafFieldArgs',
      'makeFragment',
      'makeMutation',
      'makeQuery',
      'makeSubscription',
      'objectField',
      'objectFieldArgs',
      'on',
      'skip',
      'spread',
      'sseTransport',
      'v',
      'wsTransport',
    ].sort(),
  );
});

it('keeps VERSION in step with package.json', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  expect(api.VERSION).toBe(pkg.version);
});
