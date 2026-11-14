// Web manifest (spec §6.8; P1-1b), served by app/manifest.ts as /manifest.webmanifest. Installable
// from the browser menu with no service worker. No description or categories until launch copy is
// approved; no maskable icon until Step 12.
import type { MetadataRoute } from 'next'
import { APP_NAME } from '../core/app-info'
import { BACKGROUND_COLOR, THEME_COLOR } from './brand'

export function webManifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: APP_NAME,
    short_name: APP_NAME,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    lang: 'en',
    dir: 'ltr',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
