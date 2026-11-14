// Root viewport (spec §6.1 OD-9, §6.6; P1-1b): theme colour and the dark colour scheme. Next keeps
// its default width=device-width, initial-scale=1; never maximumScale or userScalable, so browser
// zoom to 200% always works. Shared with Step 7's root layouts.
import type { Viewport } from 'next'
import { THEME_COLOR } from './brand'

export const ROOT_VIEWPORT: Viewport = { themeColor: THEME_COLOR, colorScheme: 'dark' }
