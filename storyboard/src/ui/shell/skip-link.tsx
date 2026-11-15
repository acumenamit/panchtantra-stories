// The skip link (spec §6.6 2.4.1; design p1-step7-design.md §3.12 #12, §7 item 26; P1-1c): the
// first focusable element on every page with a header, visually hidden until focused. It targets
// <main id="main" tabIndex={-1}> in app/(reader)/[locale]/(site)/layout.tsx. The label is a
// finished string from the server (t('shell.skipToMain')).
import styles from './shell.module.css'

export function SkipLink({ label }: { readonly label: string }) {
  return (
    <a href="#main" className={styles.skipLink}>
      {label}
    </a>
  )
}
