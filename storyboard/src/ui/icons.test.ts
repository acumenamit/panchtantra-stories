// Favicon and icons (spec §6.8, owner D6; P1-1b): byte-for-byte copies of the legacy "S" art from
// pt/public (read only), checked by format, pixel size and the SHA-256 recorded in design §6.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const storyboard = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path: string): Buffer => readFileSync(join(storyboard, path))
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  expect(bytes.subarray(12, 16).toString('latin1')).toBe('IHDR')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

const ICONS = [
  {
    path: 'public/favicon.ico',
    from: 'favicon.ico',
    bytes: 225,
    size: 16,
    sha256: '5c67ce620d1b6d12bfc4962276df22c4223e269c1f578959d973513b56f3a26c',
  },
  {
    path: 'app/icon.png',
    from: 'icons/icon-32.png',
    bytes: 579,
    size: 32,
    sha256: 'b859fd12d50f26be73830a4984faa5a151437088b85fb0fc8e82c0ad5c6d844c',
  },
  {
    path: 'app/apple-icon.png',
    from: 'apple-touch-icon.png',
    bytes: 3682,
    size: 180,
    sha256: '6f464cef57c0596cfad969a0c9164a0eb31d95f754eafa925fd702cfdd58ed08',
  },
  {
    path: 'public/icons/icon-192.png',
    from: 'icons/icon-192.png',
    bytes: 3932,
    size: 192,
    sha256: '8cbae5c728fa4482d9461f768745cc4ed6566ff171147b8a78384d8457aff940',
  },
  {
    path: 'public/icons/icon-512.png',
    from: 'icons/icon-512.png',
    bytes: 11688,
    size: 512,
    sha256: 'c64c9256ee92aa5d94c136bf8cb01c5ced8a15da4e864ad1cab0c7ee9f07c107',
  },
] as const

describe('icons', () => {
  it.each(ICONS.map((icon) => [icon.path, icon] as const))(
    '%s has the recorded bytes and SHA-256',
    (path, icon) => {
      const bytes = read(path)
      expect(bytes.length).toBe(icon.bytes)
      expect(sha256(bytes)).toBe(icon.sha256)
    },
  )

  it('favicon.ico is an ICO with one 16x16 entry', () => {
    const ico = read('public/favicon.ico')
    expect(ico.readUInt16LE(0)).toBe(0) // reserved
    expect(ico.readUInt16LE(2)).toBe(1) // 1 = icon
    expect(ico.readUInt16LE(4)).toBe(1) // one image
    expect(ico.readUInt8(6)).toBe(16) // width
    expect(ico.readUInt8(7)).toBe(16) // height
  })

  it.each(ICONS.filter((icon) => icon.path.endsWith('.png')).map((i) => [i.path, i] as const))(
    '%s is a square PNG at its size',
    (path, icon) => {
      expect(pngSize(read(path))).toEqual({ width: icon.size, height: icon.size })
    },
  )

  it('has no app/favicon.ico, which would emit sizes="any" and win over the 32 px PNG', () => {
    expect(existsSync(join(storyboard, 'app/favicon.ico'))).toBe(false)
  })
})
