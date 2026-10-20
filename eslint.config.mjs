import coreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

/**
 * Flat config. `eslint-config-next` 16 ships native flat configs, so no
 * compatibility shim is needed.
 *
 * The project-specific rules below encode two conventions worth enforcing:
 * `any` is banned outright (the domain is typed end to end, and an escape
 * hatch in a money or inventory path is exactly where a bug would hide), and
 * deep relative imports are banned in favour of the `@/` alias.
 */
const config = [
  ...coreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../../*'],
              message: 'Use the @/ path alias instead of deep relative imports.',
            },
          ],
        },
      ],
    },
  },
  {
    // The seed and test harness legitimately reach outside src/ and log to stdout.
    files: ['prisma/**/*.ts', 'tests/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
]

export default config
