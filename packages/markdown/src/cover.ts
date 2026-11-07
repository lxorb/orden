import { frontMatterValue } from './front-matter'
import { attributeUrl, escape, safeSrc } from './html'

export const COVER_KEY = 'cover'

export const COVER_POSITION_KEY = 'cover-position'

export const COVER_MIDDLE = 50

export interface Cover {
  src: string
  position: number
}

export function coverPosition(said: string | null | undefined): number {
  const number = Number(said)
  if (said === null || said === undefined || said === '' || !Number.isFinite(number)) {
    return COVER_MIDDLE
  }

  return Math.min(100, Math.max(0, Math.round(number)))
}

export function coverSrc(said: string): string {
  const link = /^!?\[\[([^\]]+)\]\]$/.exec(said.trim())
  const inner = link?.[1] ?? said.trim()
  const bar = inner.indexOf('|')

  return (bar === -1 ? inner : inner.slice(0, bar)).trim()
}

export function coverOf(source: string): Cover | null {
  const said = frontMatterValue(source, COVER_KEY)
  if (said === null) return null

  const src = coverSrc(said)
  if (!src) return null

  return { src, position: coverPosition(frontMatterValue(source, COVER_POSITION_KEY)) }
}

export function coverFigure(cover: Cover | null): string {
  if (cover === null || !safeSrc(cover.src)) return ''

  const src = attributeUrl(cover.src)
  const position = `object-position: 50% ${cover.position}%`

  return `<div class="orden-cover"><img src="${src}" alt="" loading="eager" style="${escape(position)}"></div>`
}
