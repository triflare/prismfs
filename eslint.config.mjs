import js from '@eslint/js';
import globals from 'globals';
import requireScratchTranslate from './eslint/require-scratch-translate.js';

export default [
  {
    ignores: ['node_modules/', 'build/', 'docs/'],
  },
  {
    files: ['**/*.js', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': [
        'warn',
        {
          // This covers normal variables (like _e)
          varsIgnorePattern: '^_',
          // This covers function arguments (like _args)
          argsIgnorePattern: '^_',
          // This covers try/catch errors (like catch (_e))
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off',
      'no-var': 'warn',
      'prefer-const': 'warn',
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        Scratch: 'readonly',
        mint: 'readonly',
      },
    },
    plugins: {
      local: {
        rules: {
          'require-scratch-translate': requireScratchTranslate,
        },
      },
    },
    rules: {
      'local/require-scratch-translate': 'error',
    },
  },
  {
    files: ['scripts/**/*.js', 'eslint.config.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
