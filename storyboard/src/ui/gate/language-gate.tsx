// The language gate on "/" in open builds (P1 D8 G1; spec §6.1 language gate; design
// p1-step7-design.md §3.6, §3.12 #7-#11, §7 items 18-20; P1-1c). A Server Component that ships
// none of our client JS: no skip link, no live region, no banner, no stores.
// - h1 "Storyboard"; the prompt in English, then in Hindi (lang="hi").
// - One link per enabled locale in registry order, styled as a large button: /{code}?remember=1
//   (the destination saves the choice, so a tap before hydration still counts and it works
//   without JavaScript), with hrefLang, lang and dir from the registry, a decorative script letter
//   (aria-hidden) and the endonym. No flags.
// - The options sit in a <ul role="list">: WebKit drops the list role of a list styled with
//   list-style: none, so without it VoiceOver on iPad and iPhone would not announce the list.
// - The remember line in English, then in Hindi.
// A returning visitor is sent on by LOCALE_REDIRECT_SCRIPT in the (gate) root layout's <head>.
import { APP_NAME } from '../../core/app-info'
import { gateOptions } from '../../reader/routing'
import { translator } from '../i18n/messages'
import styles from './gate.module.css'

export function LanguageGate() {
  const en = translator('en')
  const hi = translator('hi')
  return (
    <main>
      <h1>{APP_NAME}</h1>
      <p className={styles.prompt}>{en('gate.prompt')}</p>
      <p lang="hi" className={styles.prompt}>
        {hi('gate.prompt')}
      </p>
      <ul role="list" className={styles.options}>
        {gateOptions().map((option) => (
          <li key={option.code}>
            <a
              href={option.href}
              hrefLang={option.hrefLang}
              lang={option.lang}
              dir={option.dir}
              className={styles.option}
            >
              <span aria-hidden="true" className={styles.mark}>
                {option.mark}
              </span>
              <span className={styles.endonym}>{option.endonym}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className={styles.remember}>{en('gate.remember')}</p>
      <p lang="hi" className={styles.remember}>
        {hi('gate.remember')}
      </p>
    </main>
  )
}
