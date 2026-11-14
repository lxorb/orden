import { links } from '../../../link-index.svelte'
import { drawing, viewHtml } from '../../../markdown-view.svelte'

const MOST_KEPT = 2000

const kept = new Map<string, string>()
let keptAt = ''

export function bodyHtml(body: string, from: string | null = null): string {
  const at = `${links.version} ${drawing.version}`
  if (keptAt !== at) {
    kept.clear()
    keptAt = at
  }
  const key = `${from ?? ''}\0${body}`
  const known = kept.get(key)
  if (known !== undefined) return known
  const html = viewHtml(body, {
    escapeHtml: true,
    breaks: true,
    resolveLink: (link) => {
      if (!link.target) return null
      const found = links.targetOf(from, { kind: 'wikilink', target: link.target })
      return found === null ? null : { href: found }
    },
  })
  if (kept.size >= MOST_KEPT) {
    const oldest = kept.keys().next().value
    if (oldest !== undefined) kept.delete(oldest)
  }
  kept.set(key, html)
  return html
}

export function firstLine(body: string): string {
  const end = body.indexOf('\n')
  return end === -1 ? body : body.slice(0, end)
}

export function onlyEmoji(body: string): boolean {
  const trimmed = body.trim()
  if (!trimmed || trimmed.length > 24) return false
  return (
    /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\s)+$/u.test(trimmed) &&
    !/^[\d#*\s]+$/.test(trimmed)
  )
}
