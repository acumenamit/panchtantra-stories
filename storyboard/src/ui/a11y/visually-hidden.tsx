// Text for screen readers only (spec §6.6 4.1.2; design p1-step7-design.md §3.12 #16, §7 item 29;
// P1-1c). A CSS Module class, not base.css. No hooks, so server and client components can use it.
import type { ReactNode } from 'react'
import styles from './a11y.module.css'

export function VisuallyHidden({ children }: { readonly children: ReactNode }) {
  return <span className={styles.visuallyHidden}>{children}</span>
}
