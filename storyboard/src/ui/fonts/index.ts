// Self-hosted fonts (spec §6.1 OD-9, §6.7 Fonts, owner D7; P1-1b). next/font/local with the WOFF2
// files committed in ./files (hashes in ./files/fonts.lock.json): no network at build, served from
// /_next/static/media under font-src 'self'. The root layout puts the three .variable classes on
// <html>; tokens.css builds --font-latin and --font-hindi from them.
// - Lora v3.021 variable, unmodified upstream (Reserved Font Name): Latin, swap, the only preload,
//   with a metric-matched Times New Roman fallback face.
// - Noto Sans Devanagari 400/700, Google's Devanagari and Latin subsets (Fontsource 5.3.0): Hindi,
//   fallback, not preloaded. The unicode-ranges (Fontsource 5.3.0 400.css) decide the downloads.
//   No metric fallback: the fallback metrics come from a Latin-only sample that a Devanagari file
//   lacks. next/font requires literal options, so the ranges are written out in each call.
import localFont from 'next/font/local'

export const lora = localFont({
  src: [{ path: './files/lora-wght.woff2', weight: '400 700', style: 'normal' }],
  variable: '--font-lora',
  display: 'swap',
  preload: true,
  adjustFontFallback: 'Times New Roman',
})

export const devanagari = localFont({
  src: [
    { path: './files/noto-sans-devanagari-devanagari-400.woff2', weight: '400', style: 'normal' },
    { path: './files/noto-sans-devanagari-devanagari-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-devanagari',
  display: 'fallback',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF, U+11B00-11B09',
    },
  ],
})

export const devanagariLatin = localFont({
  src: [
    { path: './files/noto-sans-devanagari-latin-400.woff2', weight: '400', style: 'normal' },
    { path: './files/noto-sans-devanagari-latin-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-devanagari-latin',
  display: 'fallback',
  preload: false,
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
})
