import { api, BASE } from './api'
import { account } from './account.svelte'
import { attachmentFolder } from './attachments'
import { modes } from './modes.svelte'
import { invoke } from './tauri'
import { workspace } from './workspace.svelte'

/** SHA-256 of the bytes, as hex. The picture's name is its contents, so the
 *  same image pasted twice is stored once wherever it ends up. */
async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The extension to give a stored image, from what the clipboard said it is. */
function extensionFor(type: string, name: string): string {
  const fromName = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
  if (fromName && fromName.length <= 5) return fromName

  const fromType = type.split('/')[1]?.replace('+xml', '')
  return fromType && /^[a-z0-9]+$/.test(fromType) ? fromType : 'png'
}

/** Where a pasted image goes, and what to write in the note.
 *
 *  With an account the picture goes to the server, addressed by its hash: one
 *  copy however many notes use it, and every machine can already see it. The
 *  note carries a plain URL, so it still renders in an export or a published
 *  blog with nothing else to resolve.
 *
 *  Without one it lands in the folder the Attachments setting names, near the
 *  note and named by the same hash, so the space stays portable and a repeated
 *  paste still costs nothing. */
export async function storeImage(file: File, notePath: string | null): Promise<string | null> {
  const bytes = await file.arrayBuffer()
  const hash = await hashBytes(bytes)
  const extension = extensionFor(file.type, file.name)

  const token = account.token
  if (token) {
    try {
      await api.putBlob(token, hash, file.type || 'image/png', bytes)
      return `${BASE}/i/${hash}.${extension}`
    } catch (error) {
      // Out of space is the one worth saying out loud; anything else falls
      // back to keeping the image locally rather than losing the paste.
      if (error instanceof Error && /out of space/i.test(error.message)) throw error
    }
  }

  if (!notePath) return null

  // The folder is decided here and checked there: the command joins it onto the
  // note's own folder and refuses one that would leave the space.
  const folder = attachmentFolder(modes.attachments, notePath, workspace.activeSpace?.root ?? null)

  return invoke<string>('save_asset', {
    notePath,
    folder,
    name: `${hash.slice(0, 16)}.${extension}`,
    bytes: [...new Uint8Array(bytes)],
  }).catch(() => null)
}
