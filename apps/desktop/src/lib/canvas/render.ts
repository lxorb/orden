import { type EmbeddedNote, hardBreaks, renderMarkdown } from '@orden/markdown'
import { BASE } from '../api'
import { accountAddress } from '../assets'
import { isPicturePath } from '../space-paths'
import { assetUrl, joinPath } from '../tauri'
import { enginesArrived } from '../engines.svelte'
import { links } from '../link-index.svelte'
import { pointer, withPictures } from '../reading/render'

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

export function fileUrl(file: string, root: string | null): string {
  if (/^https?:\/\//i.test(file)) return file
  return root ? assetUrl(joinPath(root, file)) : file
}

export function keptByAccount(file: string, signedIn: boolean): string | null {
  if (!signedIn || !/^i\/[0-9a-f]{64}\.[a-z0-9]+$/i.test(file)) return null
  return accountAddress(`${BASE}/${file}`)
}

export function fileSource(
  file: string,
  canvasPath: string | null = null,
): Promise<EmbeddedNote | null> {
  return links.embedNote(file, null, canvasPath)
}
