'use client'
// The storage-blocked banner (spec §6.3, §6.6 4.1.3; design p1-step7-design.md §3.11 B1, §3.12
// #14-#15, §7 items 31-32; P1-1c). First thing in main on every (site) page.
// - useSyncExternalStore over both stores' subscribe and getStatus. The snapshot is a boolean (a
//   primitive, so React never sees a new object per call); the server snapshot is false, so the
//   server HTML never holds the banner and it appears after hydration, only when storage fails.
// - subscribe is defined once here, not inline, so React never resubscribes on a render.
// - One effect reads the prefs once (getSnapshot): that first read finds blocked storage or a newer
//   schema. No probe key is ever written (spec §6.3).
// - On its first appearance it announces the title once in the live region. Nothing is sent.
// - Strings arrive finished from the server (no catalogue here).
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { readerStores } from '../../reader/progress'
import { announce } from '../a11y/announce'
import { bannerVisible } from './banner-state'
import styles from './shell.module.css'

const TITLE_ID = 'storage-banner-title'

function subscribe(listener: () => void): () => void {
  const { prefs, progress } = readerStores()
  const stopPrefs = prefs.subscribe(listener)
  const stopProgress = progress.subscribe(listener)
  return () => {
    stopPrefs()
    stopProgress()
  }
}

function getSnapshot(): boolean {
  const { prefs, progress } = readerStores()
  return bannerVisible([prefs.getStatus(), progress.getStatus()])
}

function getServerSnapshot(): boolean {
  return false
}

export interface StorageBannerProps {
  readonly title: string
  readonly body: string
}

export function StorageBanner({ title, body }: StorageBannerProps) {
  const visible = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const announced = useRef(false)

  useEffect(() => {
    readerStores().prefs.getSnapshot()
  }, [])

  useEffect(() => {
    if (!visible || announced.current) return
    announced.current = true
    announce(title)
  }, [visible, title])

  if (!visible) return null
  return (
    <section aria-labelledby={TITLE_ID} className={styles.banner}>
      <p id={TITLE_ID} className={styles.bannerTitle}>
        {title}
      </p>
      <p className={styles.bannerBody}>{body}</p>
    </section>
  )
}
