/**
 * Fresh ids for things the client creates: tokens, scenes, sheets, bestiary
 * entries.
 *
 * `crypto.randomUUID` is only defined in a secure context, and a table on the
 * home network is reached over plain http at a LAN address — not localhost,
 * not https — so there it is simply absent and every "add" button dies.
 * `getRandomValues` has no such restriction, so fall back to building a v4
 * UUID from it by hand. Same shape either way; the server only asks for a
 * non-empty string.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
