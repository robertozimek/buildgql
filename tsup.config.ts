import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/client/index.ts',
    'src/cli/config.ts',
    'src/cli/index.ts',
    'src/adapters/apollo.ts',
    'src/adapters/urql.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'node18',
});
