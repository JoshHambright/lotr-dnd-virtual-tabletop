// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  // `.claude/worktrees` holds checkouts an agent is working in. Their
  // half-finished code is not this checkout's to judge.
  {
    ignores: ['**/dist/**', '**/dist-demo/**', '**/node_modules/**', '**/.wrangler/**', 'coverage/**', '.claude/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // The map canvas reads client state inside its animation frame on
      // purpose; the effect is a render loop, not a data subscription.
      'react-hooks/exhaustive-deps': 'warn',

      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // The wire is untrusted input: parsing it means asserting shapes until
      // the zod schemas land in Phase 0.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'smart'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // pdf.js is ~150 KB gzipped and must stay off the startup path. A *value*
  // import of pdf.ts is a static dependency however lazily the rest of the
  // module is used, so only `import type` and `await import()` are allowed.
  // This was documented in CLAUDE.md and regressed anyway; hence a rule.
  {
    files: ['packages/client/src/**/*.{ts,tsx}'],
    ignores: ['packages/client/src/pdf.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/pdf.js'],
              allowTypeImports: true,
              message: 'Load pdf.ts with await import(); a value import puts pdf.js in the startup bundle.',
            },
          ],
        },
      ],
    },
  },

  // Scripts are operator tools; printing is the point.
  {
    files: ['scripts/**/*.{js,mjs}', '**/build.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        URLSearchParams: 'readonly',
        atob: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
      },
    },
    rules: { 'no-console': 'off', '@typescript-eslint/no-unused-vars': 'off' },
  },
)
