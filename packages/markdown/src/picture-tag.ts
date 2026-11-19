import { attributeText, attributeUrl, escapeAll, safeSrc } from './html'

const PICTURE_TAG = /^<img\b((?:"[^"]*"|'[^']*'|[^'">])*)>$/i
const ATTRIBUTE = /\s([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/gi
const ZOOM = /^\s*zoom\s*:\s*(\d{1,3}(?:\.\d{1,2})?)%\s*;?\s*$/i
const SIZE = /^[1-9]\d{0,4}$/
const OWN = new Set(['src', 'alt', 'title', 'width', 'height', 'style'])

export function ownPicture(html: string): string | null {
  const found = PICTURE_TAG.exec(html.trim())
  if (!found) return null

  const inside = found[1] ?? ''
  const pairs = [...inside.matchAll(ATTRIBUTE)].map(
    (one) => [(one[1] ?? '').toLowerCase(), one[2] ?? one[3] ?? one[4] ?? ''] as const,
  )
  const written = new Map(pairs.map(([name, value]) => [name, attributeText(value)]))
  const rest = inside.replace(ATTRIBUTE, '').replace(/\/$/, '')
  if (written.size !== pairs.length || rest.trim()) return null
  if ([...written.keys()].some((name) => !OWN.has(name))) return null
  const style = written.get('style')
  if (style !== undefined && !ZOOM.test(style)) return null

  const src = written.get('src')
  if (!src || !safeSrc(src)) return null

  const attributes = [` src="${attributeUrl(src)}"`, ` alt="${escapeAll(written.get('alt') ?? '')}"`]
  const title = written.get('title')
  if (title) attributes.push(` title="${escapeAll(title)}"`)
  for (const name of ['width', 'height']) {
    const size = written.get(name)
    if (size && SIZE.test(size)) attributes.push(` ${name}="${size}"`)
  }
  const zoom = ZOOM.exec(written.get('style') ?? '')?.[1]
  if (zoom) attributes.push(` style="zoom:${zoom}%;"`)
  return `<img${attributes.join('')}>`
}
