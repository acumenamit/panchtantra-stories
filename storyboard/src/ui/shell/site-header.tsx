// The reader header (spec §6.1 header, §6.6 3.2.6; design p1-step7-design.md §3.12 #3-#6, §7 items
// 27-28, 35; P1-1c). A Server Component: it resolves every string with t() and passes finished
// strings, endonyms and dir values to the client HeaderNav, which needs the pathname for the
// language switch and for aria-current. No catalogue reaches the client.
import { APP_NAME } from '../../core/app-info'
import { ENABLED_LOCALE_CODES, getLocaleDef, type LocaleCode } from '../../core/locales'
import { translator } from '../i18n/messages'
import { HeaderNav, type OtherLocale } from './header-nav'
import styles from './shell.module.css'

export function SiteHeader({ locale }: { readonly locale: LocaleCode }) {
  const t = translator(locale)
  // Only the other enabled language(s), in registry order; lang and dir from the registry.
  const others: OtherLocale[] = ENABLED_LOCALE_CODES.filter((code) => code !== locale).map(
    (code) => {
      const def = getLocaleDef(code)
      return { code, endonym: def.endonym, dir: def.dir }
    },
  )
  return (
    <header className={styles.header}>
      <HeaderNav
        locale={locale}
        brand={APP_NAME}
        navLabel={t('header.navLabel')}
        changeLanguage={t('header.changeLanguage')}
        grownUps={t('header.grownUps')}
        others={others}
      />
    </header>
  )
}
