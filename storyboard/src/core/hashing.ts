// RFC 8785 (JCS) canonical JSON and SHA-256 (spec §4.1).
// Packages and snapshots are stored as their JCS bytes, so packageSha256 = sha256(file bytes).
// Uses Web Crypto, which exists in Node 24 and in browsers, so this module stays I/O-free.
import canonicalize from 'canonicalize'

export function toJcs(value: unknown): string {
  const out = canonicalize(value)
  if (out === undefined) throw new TypeError('Value cannot be represented as canonical JSON')
  return out
}

export function jcsBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(toJcs(value))
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function jcsSha256(value: unknown): Promise<string> {
  return sha256Hex(jcsBytes(value))
}
