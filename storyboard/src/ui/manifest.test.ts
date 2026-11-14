// Web manifest (spec §6.8; P1-1b): the exact values, the browser install fields, nothing that is
// not approved yet (description, service worker), and icons that exist at their declared sizes.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { webManifest } from './manifest'

const storyboard = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(bytes.subarray(12, 16).toString('latin1')).toBe('IHDR')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('webManifest', () => {
  it('holds exactly the approved values (design §6)', () => {
    expect(webManifest()).toEqual({
      id: '/',
      name: 'Storyboard',
      short_name: 'Storyboard',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      background_color: '#0d0a05',
      theme_color: '#0d0a05',
      lang: 'en',
      dir: 'ltr',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
    })
  })

  it('has the fields browsers need to offer an install', () => {
    const manifest = webManifest()
    expect(manifest.name || manifest.short_name).toBeTruthy()
    expect(manifest.start_url).toBeTruthy()
    expect(['fullscreen', 'standalone', 'minimal-ui']).toContain(manifest.display)
    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes)
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect(manifest).not.toHaveProperty('prefer_related_applications')
  })

  it('has no description, categories, shortcuts or service worker yet', () => {
    const manifest = webManifest() as Record<string, unknown>
    for (const field of ['description', 'categories', 'shortcuts', 'serviceworker']) {
      expect(manifest, field).not.toHaveProperty(field)
    }
    expect((webManifest().icons ?? []).every((icon) => icon.purpose === 'any')).toBe(true)
  })

  it.each((webManifest().icons ?? []).map((icon) => [icon.src, icon] as const))(
    '%s exists in public/ at its declared size',
    (src, icon) => {
      const file = join(storyboard, 'public', src)
      expect(existsSync(file)).toBe(true)
      const { width, height } = pngSize(readFileSync(file))
      expect(`${width}x${height}`).toBe(icon.sizes)
      expect(icon.type).toBe('image/png')
    },
  )
})
