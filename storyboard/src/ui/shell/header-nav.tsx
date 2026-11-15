'use client'
// The header's links (spec §6.1 header, §6.6 3.2.6; design p1-step7-design.md §3.12 #5-#6, §7
// items 14, 27-28, 35; P1-1c). Client only for usePathname: aria-current on the brand (home) and
// on Grown-ups, and the language switch that keeps the path. Every string arrives finished from
// SiteHeader (no catalogue here).
// - Brand: APP_NAME in Latin, lang="en" and translate="no", next/link to /{locale}.
// - Language switch: a plain <a> (a full load gives fresh server <html lang dir>) to the same path
//   in the other language with ?remember=1, so the destination saves uiLocale. A visually hidden
//   "Change language:" comes before the endonym, which carries its own lang and dir.
// - Grown-ups: next/link to /{locale}/grown-ups, in the same place on every page.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { LocaleCode, LocaleDef } from '../../core/locales'
import { REMEMBER_PARAM, switchHref } from '../../reader/routing'
import { VisuallyHidden } from '../a11y/visually-hidden'
import styles from './shell.module.css'

export interface OtherLocale {
  readonly code: LocaleCode
  readonly endonym: string
  readonly dir: LocaleDef['dir']
}

export interface HeaderNavProps {
  readonly locale: LocaleCode
  readonly brand: string
  readonly navLabel: string
  readonly changeLanguage: string
  readonly grownUps: string
  readonly others: readonly OtherLocale[]
}

export function HeaderNav({
  locale,
  brand,
  navLabel,
  changeLanguage,
  grownUps,
  others,
}: HeaderNavProps) {
  const pathname = usePathname()
  const home = `/${locale}`
  const grownUpsHref = `/${locale}/grown-ups`
  return (
    <>
      <Link
        href={home}
        className={`${styles.link} ${styles.brand}`}
        lang="en"
        translate="no"
        aria-current={pathname === home ? 'page' : undefined}
      >
        {brand}
      </Link>
      <nav aria-label={navLabel} className={styles.nav}>
        {others.map((other) => (
          <a
            key={other.code}
            href={`${switchHref(pathname, other.code)}?${REMEMBER_PARAM}=1`}
            hrefLang={other.code}
            className={`${styles.link} ${styles.switch}`}
          >
            <VisuallyHidden>{`${changeLanguage} `}</VisuallyHidden>
            <span lang={other.code} dir={other.dir} className={styles.switchName}>
              {other.endonym}
            </span>
          </a>
        ))}
        <Link
          href={grownUpsHref}
          className={styles.link}
          aria-current={pathname === grownUpsHref ? 'page' : undefined}
        >
          <span className={styles.label}>{grownUps}</span>
        </Link>
      </nav>
    </>
  )
}
