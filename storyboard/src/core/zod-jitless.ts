// zod without its eval probe (spec §9 CSP, §10.2 "zero CSP violations"; design
// p1-step7-design.md §11 R10; P1-1c fix). zod 4 calls `new Function('')` when it builds an object
// schema, to pick its compiled fast path. The spec CSP has no 'unsafe-eval', so in a browser the
// call throws and reports a script-src violation; the storage banner and ChoiceRecorder bring the
// stores, and with them zod, into every reader page (R10). jitless turns the probe and the compiled
// path off; what a schema accepts and returns does not change.
// Every module under src/ and app/ that loads zod imports this file first, so the setting is in
// place before any schema is built (src/ui/i18n/client-boundary.test.ts checks it). The modules
// keep `import { z } from 'zod'`, which the bundler can tree-shake; a module that re-exported z
// would pull all of zod into reader pages.
import { config } from 'zod'

config({ jitless: true })
