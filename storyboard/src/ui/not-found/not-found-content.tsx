// The bilingual 404 body (spec §6.1 not found; design p1-step7-design.md §3.12 #2, §4.3, §7 item
// 13; P1-1c), rendered by app/global-not-found.tsx for every unmatched URL. The page is English;
// every Hindi part carries lang="hi". No header, no "404", no blame, no auto-redirect.
// - h1 "Page not found" with "पेज नहीं मिला" on a second line.
// - The English paragraph, then the Hindi one.
// - One link to "/", a plain <a> ("/" is another root layout, so a full load anyway; no prefetch).
import { translator } from '../i18n/messages'
import styles from './not-found.module.css'

export function NotFoundContent() {
  const en = translator('en')
  const hi = translator('hi')
  return (
    <main>
      <h1>
        {en('notFound.title')}{' '}
        <span lang="hi" className={styles.titleHi}>
          {hi('notFound.title')}
        </span>
      </h1>
      <p>{en('notFound.body')}</p>
      <p lang="hi" className={styles.bodyHi}>
        {hi('notFound.body')}
      </p>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- "/" is another root layout, so a full load anyway (design §7 item 13) */}
      <a href="/" className={styles.link}>
        <span>{en('notFound.link')}</span>{' '}
        <span lang="hi" className={styles.linkHi}>
          {hi('notFound.link')}
        </span>
      </a>
    </main>
  )
}
