import { type EmbeddedNote, hardBreaks, renderMarkdown } from '@orden/markdown'
import { pageOfSubpath } from '@orden/markdown/canvas'
import { embedKind, isTabFile, parseWikilink, sectionOf } from '@orden/markdown/links'
import { BASE } from '../../accounts/src/api'
import { accountAddress } from '../../workspace/src/api'
import { isPicturePath, assetUrl, joinPath } from '../../platform/src/api'
import { enginesArrived } from './engines.svelte'
import { links } from '../../link-index/src/api'
import { pointer, withPictures } from '../../reading/src/api'

const MOST = 600

const cache = new Map<string, string>()
let at = -1

export function cardHtml(text: string, canvasPath: string | null, trusted: boolean): string {
  if (at !== links.version) {
    at = links.version
    cache.clear()
  }

  const key = `${trusted ? 'own' : 'theirs'}\n${hardBreaks() ? 'br' : 'flow'}\n${enginesArrived()}\n${canvasPath ?? ''}\n${text}`
  const held = cache.get(key)
  if (held !== undefined) return held

  const card = { text, path: canvasPath }
  const html = withPictures(
    renderMarkdown(text, {
      footnotes: true,
      escapeHtml: !trusted,
      resolveLink: pointer(card),
    }),
    card,
  )

  if (cache.size >= MOST) cache.clear()
  cache.set(key, html)

  return html
}

export function isPicture(file: string): boolean {
  return isPicturePath(file)
}

export function pageOfFile(node: { subpath?: string }): number {
  return pageOfSubpath(node.subpath) ?? 1
}

export function fileUrl(file: string, root: string | null): string {
  if (/^https?:\/\//i.test(file)) return file
  return root ? assetUrl(joinPath(root, file)) : file
}

export function keptByAccount(file: string, signedIn: boolean): string | null {
  if (!signedIn || !/^i\/[0-9a-f]{64}\.[a-z0-9]+$/i.test(file)) return null
  return accountAddress(`${BASE}/${file}`)
}

export type FileShown = 'picture' | 'sound' | 'film' | 'pdf' | 'file' | 'words'

export function fileShown(file: string): FileShown {
  const bare = file.replace(/[?#].*$/, '')
  if (isPicturePath(bare)) return 'picture'
  const kind = embedKind(bare)
  if (kind === 'audio') return 'sound'
  if (kind === 'video') return 'film'
  if (kind === 'pdf') return 'pdf'
  return isTabFile(bare) ? 'file' : 'words'
}

export async function fileSource(
  file: string,
  canvasPath: string | null = null,
  subpath?: string,
): Promise<EmbeddedNote | null> {
  if (fileShown(file) !== 'words') return null
  const note = await links.embedNote(file, null, canvasPath)
  const named = subpath ? parseWikilink(`x${subpath}`) : null
  if (!note || !named) return note
  const text = sectionOf(note.text, named)
  return text === null ? null : { ...note, text }
}
