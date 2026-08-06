import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `test/built/**` asserts on BUILT output and so needs `dist/` to exist. `npm run check`
    // runs `npm run build` (~1.4s) before `npm run test`; a bare `vitest run` on an unbuilt
    // tree fails loudly with instructions rather than skipping, on purpose. The directory is
    // NOT called `test/dist` — vitest's default `exclude` carries `**/dist/**`, which would
    // match it and silently collect nothing.
    include: ['test/unit/**/*.test.ts', 'test/e2e/**/*.test.ts', 'test/built/**/*.test.ts'],
  },
});
