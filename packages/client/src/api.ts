/** The handful of plain HTTP calls: opening a table and uploading images. */

export interface CreatedRoom {
  code: string
  gmKey: string
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? fallback
}

export async function createRoom(name: string): Promise<CreatedRoom> {
  const response = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) throw new Error(await readError(response, 'Could not open a table'))
  return (await response.json()) as CreatedRoom
}

export async function roomExists(code: string): Promise<boolean> {
  const response = await fetch(`/api/room/${encodeURIComponent(code)}/exists`)
  if (!response.ok) return false
  const body = (await response.json()) as { exists: boolean }
  return body.exists
}

export interface UploadedAsset {
  id: string
  width: number
  height: number
}

/**
 * Shrinks an image before it goes over the wire. A phone photo of a hand-drawn
 * map is 4000px of detail nobody can see at table zoom, and the room's storage
 * is shared by every map in the campaign.
 */
export async function prepareImage(file: File, maxEdge = 3000): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  if (scale === 1 && file.size < 4 * 1024 * 1024) {
    bitmap.close()
    return { blob: file, width, height }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot resize images')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9))
  if (!blob) throw new Error('Could not read that image')
  return { blob, width, height }
}

/** Uploads an already-prepared bitmap, which is what a rasterized PDF page is. */
export async function uploadBlob(
  code: string,
  gmKey: string,
  blob: Blob,
  width: number,
  height: number,
): Promise<UploadedAsset> {
  const response = await fetch(`/api/room/${encodeURIComponent(code)}/asset?key=${encodeURIComponent(gmKey)}`, {
    method: 'PUT',
    headers: { 'content-type': blob.type || 'image/webp' },
    body: blob,
  })
  if (!response.ok) throw new Error(await readError(response, 'Could not upload that image'))
  const body = (await response.json()) as { id: string }
  return { id: body.id, width, height }
}

export async function uploadAsset(code: string, gmKey: string, file: File): Promise<UploadedAsset> {
  const { blob, width, height } = await prepareImage(file)
  const response = await fetch(`/api/room/${encodeURIComponent(code)}/asset?key=${encodeURIComponent(gmKey)}`, {
    method: 'PUT',
    headers: { 'content-type': blob.type || 'image/webp' },
    body: blob,
  })
  if (!response.ok) throw new Error(await readError(response, 'Could not upload that image'))
  const body = (await response.json()) as { id: string }
  return { id: body.id, width, height }
}

export function assetUrl(code: string, assetId: string, gmKey: string | null): string {
  const key = gmKey ? `?key=${encodeURIComponent(gmKey)}` : ''
  return `/api/room/${encodeURIComponent(code)}/asset/${encodeURIComponent(assetId)}${key}`
}
