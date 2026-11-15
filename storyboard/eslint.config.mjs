import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

// A hex colour or a colour function in a JSX style string (the JSX style rules below, P1-1b).
const JSX_COLOR_LITERAL = String.raw`/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/`

// The reader fence's import patterns (spec §10.2; P1-1a, P1-1b; P1-1c design
// p1-step7-design.md §8.2). A later flat-config block that sets no-restricted-imports replaces
// these options for the files it matches, so the two exception blocks below rebuild the list from
// these constants and leave out only what they allow.
const SUPABASE = {
  group: ['@supabase/*'],
  message: 'Reader code must not import Supabase clients.',
}
const SCRIPTS = {
  group: ['**/scripts', '**/scripts/**'],
  message: 'Reader code must not import scripts/.',
}
const TOOLS = { group: ['**/tools', '**/tools/**'], message: 'Reader code must not import tools/.' }
const NETWORK_AT_BUILD = {
  group: ['next/font/google', 'next/og'],
  message: 'fetches from the network at build',
}
// P1-1c: reader pages are static (spec §3.2), so no request-time APIs. Step 20's route handlers
// (app/api/**) are request-time by design and keep next/headers and next/server.
const STATIC_ONLY = 'Reader pages are static: no request-time APIs (spec §3.2; P1-1c).'
const REQUEST_TIME = { group: ['next/headers', 'next/server'], message: STATIC_ONLY }
const ROOT_PARAMS = { group: ['next/root-params'], message: STATIC_ONLY }
// P1-1c (P1 D8): no next-intl; its navigation writes a NEXT_LOCALE cookie (spec §9: no cookies).
const NEXT_INTL = {
  group: ['next-intl', 'next-intl/*'],
  message: 'No next-intl: it writes a locale cookie (P1 D8; spec §9).',
}
// P1-1c (P1 D8): only src/ui/i18n/messages.ts (server-only) imports the catalogues; tests read the
// files with readFileSync.
const MESSAGES_JSON = {
  group: ['**/messages/*.json'],
  message: 'Only src/ui/i18n/messages.ts imports messages/*.json (server-only; P1 D8).',
}
const READER_FENCE = [
  SUPABASE,
  SCRIPTS,
  TOOLS,
  NETWORK_AT_BUILD,
  REQUEST_TIME,
  ROOT_PARAMS,
  NEXT_INTL,
  MESSAGES_JSON,
]
const without = (excluded) => READER_FENCE.filter((pattern) => pattern !== excluded)

// P1-1c (design §8.2): reader code never reads process.env (the launch flag is read in
// src/config/launch.ts), sets no cookie, and touches Web Storage only through
// src/reader/progress/device-storage.ts. Test files use fakes and are not fenced.
const NO_ENV = {
  object: 'process',
  property: 'env',
  message:
    'Reader code does not read process.env; the launch flag is read in src/config/launch.ts.',
}
const NO_COOKIE = {
  object: 'document',
  property: 'cookie',
  message: 'The site sets no cookies (spec §9).',
}
const STORAGE_ONLY_IN_DEVICE_STORAGE =
  'Web Storage is used only by src/reader/progress/device-storage.ts (spec §6.3).'
const NO_WINDOW_STORAGE = ['localStorage', 'sessionStorage'].map((property) => ({
  object: 'window',
  property,
  message: STORAGE_ONLY_IN_DEVICE_STORAGE,
}))
const NO_COOKIE_STORE = { name: 'cookieStore', message: 'The site sets no cookies (spec §9).' }
const NO_STORAGE_GLOBALS = ['localStorage', 'sessionStorage'].map((name) => ({
  name,
  message: STORAGE_ONLY_IN_DEVICE_STORAGE,
}))
const READER_FILES = ['src/reader/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}', 'src/ui/**/*.{ts,tsx}']
const TEST_FILES = ['**/*.test.ts']

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
    // P1-1c adds next/headers, next/server, next/root-params, next-intl and messages/*.json.
    files: READER_FILES,
    rules: {
      'no-restricted-imports': ['error', { patterns: READER_FENCE }],
    },
  },
  {
    // P1-1c: the one importer of the message catalogues; every other fence pattern still applies.
    files: ['src/ui/i18n/messages.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: without(MESSAGES_JSON) }],
    },
  },
  {
    // P1-1c: Step 20's route handlers are request-time by design (spec §3.4), so next/headers and
    // next/server are allowed there; every other fence pattern still applies. Step 20 decides this
    // fence finally; no app/api file exists yet.
    files: ['app/api/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: without(REQUEST_TIME) }],
    },
  },
  {
    // P1-1c (design §8.2): no process.env, no cookie and no direct Web Storage in reader code.
    files: READER_FILES,
    ignores: TEST_FILES,
    rules: {
      'no-restricted-properties': ['error', NO_ENV, NO_COOKIE, ...NO_WINDOW_STORAGE],
      'no-restricted-globals': ['error', NO_COOKIE_STORE, ...NO_STORAGE_GLOBALS],
    },
  },
  {
    // The device storage is the only Web Storage user (spec §6.3); env and cookies stay banned.
    files: ['src/reader/progress/device-storage.ts'],
    rules: {
      'no-restricted-properties': ['error', NO_ENV, NO_COOKIE],
      'no-restricted-globals': ['error', NO_COOKIE_STORE],
    },
  },
  {
    // Step 20's route handlers read server env (spec §3.5); cookies and Web Storage stay banned.
    files: ['app/api/**/*.{ts,tsx}'],
    ignores: TEST_FILES,
    rules: {
      'no-restricted-properties': ['error', NO_COOKIE, ...NO_WINDOW_STORAGE],
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
