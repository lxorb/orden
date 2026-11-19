import { canWriteAt } from '../../sharing/src/api'
import { newSite, type Sites } from './new-site'
import { droppedAddress, plainOrigin } from '@orden/scan/web-address'

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function linkWords(html: string): string {
  const inner = /<a(?:\s[^>]*)?>([\s\S]*?)<\/a>/i.exec(html)?.[1] ?? ''
  return inner
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (whole, name: string) => {
      if (!name.startsWith('#')) return ENTITIES[name.toLowerCase()] ?? whole
      const hex = name.startsWith('#x') || name.startsWith('#X')
      const code = hex ? parseInt(name.slice(2), 16) : Number(name.slice(1))
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole
    })
    .replace(/\s+/g, ' ')
    .trim()
}

export async function siteDropped(ws: Sites, folder: string, list: string, html: string): Promise<string | null> {
  if (!canWriteAt(folder)) return null
  const url = droppedAddress((type) => (type === 'text/uri-list' ? list : ''))
  if (url === null) return null

  const words = linkWords(html)
  const title = words && words !== url ? words : plainOrigin(url)
  return newSite(ws, folder, title, url)
}
