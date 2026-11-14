import type { Preview } from '@orden/chats'
import { isRecord, isString, invoke, isDesktop } from '../platform/src/api'

const WIDEST = 480

async function smaller(bytes: Uint8Array, type: string): Promise<Uint8Array> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return bytes
  try {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type }))
    const scale = Math.min(1, WIDEST / bitmap.width)
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    )
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })
    return new Uint8Array(await blob.arrayBuffer())
  } catch {
    return bytes
  }
}

function bytesOf(base64: string): Uint8Array {
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let at = 0; at < raw.length; at++) out[at] = raw.charCodeAt(at)
  return out
}

export async function previewOf(
  url: string,
  upload: (bytes: Uint8Array) => Promise<string | null>,
): Promise<Preview | null> {
  if (!isDesktop || !/^https?:\/\//i.test(url)) return null
  const page = await invoke<unknown>('link_preview', { url }).catch(() => null)
  if (!isRecord(page) || !isString(page.url) || !isString(page.title) || !page.title) return null

  const preview: Preview = { url: page.url, title: page.title }
  if (isString(page.site) && page.site) preview.site = page.site
  if (isString(page.text) && page.text) preview.text = page.text
  if (isString(page.picture) && isString(page.pictureType)) {
    const picture = await smaller(bytesOf(page.picture), page.pictureType)
    const hash = await upload(picture)
    if (hash) preview.picture = hash
  }
  return preview
}
