import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      // Machine-written.
      'test/perf/generated.ts',
      'test/perf/tsconfig.json',
      // Outside tsconfig's `include`, so `projectService` cannot type them.
      'eslint.config.js',
      'tsup.config.ts',
      'vitest.config.ts',
      '**/*.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { unicorn },
    rules: {
      // The naming scheme documented in docs/superpowers/plans — types PascalCase,
      // values camelCase, module-level constants either camelCase or UPPER_CASE.
      // `leadingUnderscore: 'allow'` covers deliberately-unused params like `_wrap`.
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'interface', format: ['PascalCase'], custom: { regex: '^I[A-Z]', match: false } },
        { selector: 'function', format: ['camelCase'] },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        // Object literal keys are GraphQL field names and wire-protocol keys
        // (`__typename`, `content-type`, `connection_init`) — not ours to rename.
        { selector: 'objectLiteralProperty', format: null },
        { selector: 'typeProperty', format: null },
      ],
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',

      // Companion to the naming-convention `leadingUnderscore: 'allow'` above: without
      // `argsIgnorePattern`, `no-unused-vars` still flags a deliberately-unused trailing
      // param like builders.ts's `_wrap` (default `args: 'after-used'` only spares an
      // unused param that precedes a later, used one).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // `{}` is load-bearing here: it is the "this selection contributes no
      // variables" identity, and `UnionToIntersection` in src/types/util.ts
      // normalises the empty union to it on purpose. Banning it would force
      // `Record<string, never>`, which does NOT intersect the same way.
      '@typescript-eslint/no-empty-object-type': 'off',

      // The builders carry phantom type parameters (`W`, `T`, `Spec`) that appear
      // only inside `as unknown as` casts. The rule cannot see that use and
      // reports every one of them as unnecessary.
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
    },
  },
  {
    // Phantom-type attachment lives here and nowhere else — builders.ts,
    // fragment.ts and directives.ts each document why the cast is load-bearing.
    // Scoped rather than project-wide so a genuinely redundant assertion in the
    // client, codegen or adapters still gets reported.
    files: ['src/runtime/**/*.ts'],
    rules: { '@typescript-eslint/no-unnecessary-type-assertion': 'off' },
  },
  {
    // `IR` here is a domain prefix — Intermediate Representation — not Hungarian-notation
    // `I`-prefixing; the interface regex above can't tell them apart. IRSchema, IRType,
    // IRField, IRArg and IRTypeRef are load-bearing names used throughout src/codegen
    // (and by later refactor tasks), so the fix is scoping the check off here rather
    // than renaming.
    files: ['src/codegen/ir.ts'],
    rules: { '@typescript-eslint/naming-convention': 'off' },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      // Type tests assert on unused locals and deliberately-wrong calls.
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',

      // Type-level tests (test/types/**) name parameters after the type parameters they
      // probe (`Q`, `U`, `P`...) and assign results to throwaway `_1`, `_2`... aliases —
      // neither fits production naming.
      '@typescript-eslint/naming-convention': 'off',
      // Runtime tests reassert types defensively (e.g. after `as typeof fetch` casts)
      // and mocks satisfy async interface signatures without an internal `await` or
      // `yield` — both are systemic to how these tests are written, not one-off bugs.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
      'require-yield': 'off',
      // Vitest mocks routinely destructure Node builtin functions (`path.join`) and probe
      // `Object.prototype` members by bracket key — both read by the type checker as an
      // unbound method reference, though neither is ever detached and called with `this`.
      '@typescript-eslint/unbound-method': 'off',
      // `@ts-expect-error` type tests use a bare expression statement (no assignment) to
      // make the checker evaluate — and reject — the following line.
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  prettier,
);
