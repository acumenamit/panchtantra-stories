import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Spec §10.2 import fence: src/core stays pure (no framework, no I/O clients).
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['next', 'next/*', 'react', 'react-dom'],
              message: 'src/core must stay framework-free.',
            },
            { group: ['@supabase/*'], message: 'src/core must not import Supabase clients.' },
            {
              group: ['node:fs', 'fs', 'node:net', 'node:http', 'node:https'],
              message: 'src/core must not do I/O.',
            },
          ],
        },
      ],
    },
  },
  {
    // Spec §10.2 import fence: reader code may not import Supabase clients or scripts/.
    // tools/ is fenced too: tools/publisher holds a Storage client that uses the secret key.
    files: ['src/reader/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@supabase/*'], message: 'Reader code must not import Supabase clients.' },
            {
              group: ['**/scripts', '**/scripts/**'],
              message: 'Reader code must not import scripts/.',
            },
            { group: ['**/tools', '**/tools/**'], message: 'Reader code must not import tools/.' },
          ],
        },
      ],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'playwright-report/**',
    'test-results/**',
  ]),
])

export default eslintConfig
