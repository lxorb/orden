import { mimeOfPath, normalise, showAssetsFrom, UNKNOWN_TYPE } from '../../../platform/src/api'

interface Held {
  blob: Blob
  url: string | null
}
const held = new Map<string, Held>()
const shown = new Map<string, string>()
let asked = false
async function same(blob: Blob, bytes: Uint8Array): Promise<boolean> {
  if (blob.size !== bytes.length) return false
  const before = new Uint8Array(await blob.arrayBuffer())
  return before.every((byte, at) => byte === bytes[at])
}
export async function holdAsset(path: string, bytes: Uint8Array): Promise<void> {
  if (!asked) {
    asked = true
    showAssetsFrom({ url: heldAssetUrl, path: heldAssetPath })
  }
  const at = normalise(path)
  const before = held.get(at)
  if (before && (await same(before.blob, bytes))) return
  dropAsset(at)
  held.set(at, {
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeOfPath(at) ?? UNKNOWN_TYPE }),
    url: null,
  })
}
export function dropAsset(path: string): void {
  const at = normalise(path)
  const one = held.get(at)
  if (!one) return
  held.delete(at)
  if (one.url === null) return
  shown.delete(one.url)
  URL.revokeObjectURL(one.url)
}
function heldAssetUrl(path: string): string | null {
  const at = normalise(path)
  const one = held.get(at)
  if (!one) return null
  if (one.url === null) {
    one.url = URL.createObjectURL(one.blob)
    shown.set(one.url, at)
  }
  return one.url
}
const heldAssetPath = (url: string): string | null => shown.get(url.split('#')[0] ?? url) ?? null
