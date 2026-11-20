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
        extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked, reactHooks.configs.flat['recommended-latest']],
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
        },
    },
    {
        // These files still set state in effects; they are fixed one by one under #407.
        files: ['src/contexts/SearchContext.tsx', 'src/App.tsx'],
        rules: {
            'react-hooks/set-state-in-effect': 'off',
        },
    },
    {
        // These files still read refs during render; they are fixed one by one under #407.
        files: ['src/contexts/SearchContext.tsx', 'src/features/library/components/ViewControls.tsx', 'src/App.tsx'],
        rules: {
            'react-hooks/refs': 'off',
        },
    }
);
