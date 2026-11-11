import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src-tauri/**',
      'src/bindings.ts',
      // Test files are linted separately once a test override exists (#408).
      'src/test/**',
      'src/**/__tests__/**',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'vite.config.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat['recommended-latest'],
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': ['error', { fixToUnknown: true }],
      '@typescript-eslint/no-floating-promises': 'error',
      // React ignores the return value of JSX event handlers, so an async handler such as
      // onClick={async () => ...} is not a misuse. typescript-eslint's React guidance turns
      // this check off for JSX attributes; unhandled rejections there are tracked separately.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/await-thenable': 'error',
      // A leading underscore marks a name that is unused on purpose.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // An async function without await still returns a rejected promise instead of throwing
      // synchronously; callers and Promise-returning interfaces rely on that.
      '@typescript-eslint/require-await': 'off',
      'react-hooks/exhaustive-deps': 'error',
      // React Compiler rules with existing findings; fixing them restructures components (#407).
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
);
