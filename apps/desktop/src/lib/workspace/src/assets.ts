import { BASE, account, usage } from '../../accounts/src/api'
import { assetFolder } from '../../modes/src/api'
import { holdPicture, sha256, spaceRelative } from '../../platform/src/api'
import { saveAsset } from '../../file-writes/src/api'
import { links } from '../../link-index/src/api'
import { workspace } from './workspace.svelte'

function extensionFor(type: string, name: string): string {
  const fromName = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
  if (fromName && fromName.length <= 5) return fromName
  const fromType = type.split('/')[1]?.replace('+xml', '')
  return fromType && /^[a-z0-9]+$/.test(fromType) ? fromType : 'png'
}
const fits = (size: number): boolean => !usage.full && (usage.limit <= 0 || usage.used + size <= usage.limit)
export async function storeImage(file: File, notePath: string | null): Promise<string | null> {
  const bytes = await file.arrayBuffer()
  const hash = await sha256(bytes)
  const extension = extensionFor(file.type, file.name)
  const type = file.type || 'image/png'
  const whose = account.accountToken ? account.user?.id : undefined
  if (whose) {
    if (!fits(bytes.byteLength)) throw new Error('That image does not fit in your storage.')
    holdPicture(hash, new Blob([bytes], { type }))
    void import('./pictures-owed').then(({ owe }) => owe({ hash, type, bytes, whose }))
    return `${BASE}/i/${hash}.${extension}`
  }
  if (!notePath) return null
  return storeBeside(bytes, notePath, `${hash.slice(0, 16)}.${extension}`)
}
export function accountAddress(stored: string): string | null {
  if (!stored.startsWith(`${BASE}/i/`)) return null
  return /^https?:\/\//i.test(stored) ? stored : new URL(stored, location.href).href
}
const MOST_BYTES = 24 * 1024 * 1024
export async function storeAttachment(file: File, notePath: string | null): Promise<string | null> {
  if (!notePath) return null
  if (file.size > MOST_BYTES) throw new Error('That file is larger than a note can keep.')
  const bytes = await file.arrayBuffer()
  const name = `${(await sha256(bytes)).slice(0, 16)}.${extensionFor(file.type, file.name)}`
  const written = await storeBeside(bytes, notePath, name)
  if (!written) return null
  void workspace.loadTree()
  return written
}
export async function storeBeside(bytes: ArrayBuffer, notePath: string, name: string): Promise<string | null> {
  const root = workspace.rootHolding(notePath)
  const folder = assetFolder(notePath, root)
  const written = await saveAsset(notePath, folder, name, new Uint8Array(bytes)).catch(() => null)
  const relative = written === null || root === null ? null : spaceRelative(root, notePath, written)
  if (root !== null && relative) links.fileWritten(root, relative)
  return written
}
