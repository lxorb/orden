/** A message's words as they read (docs/chats.md 3, #1): through the renderer every
 *  note is read with - the way markdown-view.svelte.ts draws a string, which is the AI
 *  panel's way too, so a formula, a coloured block or a diagram an agent writes into a
 *  chat is drawn as it is in a note and in the panel - with two
 *  differences that are about a message rather than a document. Somebody else wrote it,
 *  so its raw HTML is shown as the characters it is, never run, as a published page does
 *  (`escapeHtml`); and a single newline is a line break, as every chat has it.
 *
 *  A `[[wikilink]]` points into the space the way a note's does. Rendered once per
 *  wording: a message is drawn many times as it scrolls past and changes rarely, so the
 *  HTML is kept by its words. */

import { links } from '../../link-index.svelte'
import { drawing, viewHtml } from '../../markdown-view.svelte'

/** The most wordings kept: several pages of a busy chat. */
const MOST_KEPT = 2000

const kept = new Map<string, string>()
/** Which version of the link index, and which landing of the renderer's parts, the
 *  kept HTML was drawn from. */
let keptAt = ''

/** `from` is the chat's pointer, so its links resolve in the chat's own space, which a
 *  chat still open from another space is not the active one. Kept by the words and by
 *  where they are, and drawn again once the index has changed: a chat of another space
 *  is drawn before that space's notes have been read, and once a part of the renderer it
 *  asked for - the formula engine, a fence's grammar - has landed. */
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

/** A message's first line, as a quote or a list shows it. */
export function firstLine(body: string): string {
  const end = body.indexOf('\n')
  return end === -1 ? body : body.slice(0, end)
}

/** Whether a message is a few emoji and nothing else, which a chat draws large. */
export function onlyEmoji(body: string): boolean {
  const trimmed = body.trim()
  if (!trimmed || trimmed.length > 24) return false
  return (
    /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\s)+$/u.test(trimmed) &&
    !/^[\d#*\s]+$/.test(trimmed)
  )
}
