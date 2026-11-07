import { api, BASE } from './api'
import { account } from './account.svelte'
import { attachmentFolder } from './attachments'
import { sha256 } from './bytes'
import { key } from './i18n.svelte'
import { links } from './link-index.svelte'
import { modes } from './modes.svelte'
import { spaceRelative } from './recorder/paths'
import { invoke } from './tauri'
import { workspace } from './workspace.svelte'

function extensionFor(type: string, name: string): string {
  const fromName = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
  if (fromName && fromName.length <= 5) return fromName

  const fromType = type.split('/')[1]?.replace('+xml', '')
  return fromType && /^[a-z0-9]+$/.test(fromType) ? fromType : 'png'
}

export async function storeImage(file: File, notePath: string | null): Promise<string | null> {
  const bytes = await file.arrayBuffer()
  const hash = await sha256(bytes)
  const extension = extensionFor(file.type, file.name)

  const token = account.accountToken
  if (token) {
    try {
      await api.putBlob(token, hash, file.type || 'image/png', bytes)
      return `${BASE}/i/${hash}.${extension}`
    } catch (error) {
      if (error instanceof Error && /out of space/i.test(error.message)) throw error
    }
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
  if (file.size > MOST_BYTES) throw new Error(key('That file is larger than a note can keep.'))

  const written = await storeBeside(await file.arrayBuffer(), notePath, file.name)
  if (!written) return null

  const root = workspace.rootHolding(notePath)
  const relative = root === null ? null : spaceRelative(root, notePath, written)
  if (root !== null && relative) links.fileWritten(root, relative)
  void workspace.loadTree()

  return written
}

export function storeBeside(
  bytes: ArrayBuffer,
  notePath: string,
  name: string,
): Promise<string | null> {
  const folder = attachmentFolder(modes.attachments, notePath, workspace.rootHolding(notePath))

  return invoke<string>('save_asset', {
    notePath,
    folder,
    name,
    bytes: new Uint8Array(bytes),
  }).catch(() => null)
}
