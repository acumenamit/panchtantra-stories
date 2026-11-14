import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

// A hex colour or a colour function in a JSX style string (the JSX style rules below, P1-1b).
const JSX_COLOR_LITERAL = String.raw`/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/`

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
    // The app/ routes are reader code too, so the same fence covers them (P1-1a).
    // src/ui (tokens, fonts, manifest) is reader code as well, and next/font/google and next/og
    // are banned in all of it: both fetch from the network at build (P1-1b, owner D5/D7).
    files: ['src/reader/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}', 'src/ui/**/*.{ts,tsx}'],
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
            {
              group: ['next/font/google', 'next/og'],
              message: 'fetches from the network at build',
            },
          ],
        },
      ],
    },
  },
  {
    // Spec §6.7 RC-12 and §6.6 contrast (P1-1b, owner D5): a JSX style is an object literal that
    // sets only custom properties (style={{ '--x': 'var(--y)' }}), with no spread and no colour
    // literal, and there is no <style> element. Physical properties, colours and literals live in
    // CSS, where scripts/lint/css-lint.ts checks them. Custom properties are typed by the
    // module augmentation in src/ui/react-css.d.ts, never by a cast (a cast fails rule 1).
    files: ['app/**/*.tsx', 'src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXAttribute[name.name='style'] > JSXExpressionContainer > :not(ObjectExpression)",
          message: 'JSX style must be an object literal (no variable, call or cast).',
        },
        {
          selector:
            "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression > Property[key.type='Identifier']",
          message: 'JSX style may set only custom properties (--name); put other styles in CSS.',
        },
        {
          selector:
            "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression > Property[key.type='Literal']:not([key.value=/^--/])",
          message: 'JSX style may set only custom properties (--name); put other styles in CSS.',
        },
        {
          // A computed key that is neither of the above (a template, member or call) could name
          // any property, so it is rejected too.
          selector:
            "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression > Property[computed=true]:not([key.type='Identifier']):not([key.type='Literal'])",
          message: 'JSX style may set only custom properties (--name); put other styles in CSS.',
        },
        {
          selector:
            "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression > SpreadElement",
          message: 'JSX style may not spread another object.',
        },
        {
          selector: `JSXAttribute[name.name='style'] Literal[value=${JSX_COLOR_LITERAL}]`,
          message: 'JSX style may not hold a colour literal; use a colour token.',
        },
        {
          selector: `JSXAttribute[name.name='style'] TemplateElement[value.raw=${JSX_COLOR_LITERAL}]`,
          message: 'JSX style may not hold a colour literal; use a colour token.',
        },
        {
          selector: "JSXOpeningElement[name.name='style']",
          message: 'No <style> elements; put styles in a CSS file.',
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
