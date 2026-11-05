/** A model's answer as a page of the app draws it: the AI panel's and the quick
 *  question's.
 *
 *  The way a note is read - markdown-view.svelte.ts, the reading view's renderer with
 *  its fences, its formulas and its footnotes - with the model's raw HTML escaped, since
 *  a model's words are nobody's markup. And with nothing loaded from anywhere that the
 *  reader did not ask for: a note that talked a model into writing
 *  `![](https://somewhere/?what-you-wrote)` would otherwise have sent it. A picture of
 *  the reader's own - a file in the space, a `data:` one - is drawn where it stands, as
 *  the note it came from draws it; one from elsewhere is a button with its words on it,
 *  and a press shows it (`shownPictures`). Frames and players are taken out. Links stay,
 *  and are followed by whoever draws them.
 *
 *  A block of code wears a bar over it with its language and a copy button, ChatGPT's
 *  way: code in an answer is there to be taken somewhere else, and selecting it by hand
 *  out of a scrolling box is the one fiddly part of that. */

import type { RenderOptions } from '@orden/markdown'
import { escape } from '@orden/markdown/html'
import { viewHtml } from '../markdown-view.svelte'
import { notePicture } from '../note-images'

type LinkResolver = NonNullable<RenderOptions['resolveLink']>

/** Frames and players: what an answer may not load. */
const MEDIA = /<(?:iframe|video|audio|source|picture|object|embed)\b[^>]*>/gi

/** A picture, as the renderer writes one. */
const PICTURE = /<img\b([^>]*)>/gi

/** An address somewhere else, which is what a picture is held back for. */
const ELSEWHERE = /^(?:[a-z][a-z\d+.-]*:)?\/\//i

/** A fenced block as the renderer writes it, and the language it names if any. */
const BLOCK = /<pre><code(?: class="language-([^"]*)")?>/g

/** The copy button's two faces, drawn by Answer.svelte as the press goes. */
const COPY_PATH =
  'M4.5 4.5V3a1 1 0 0 1 1-1H10a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H8.5M3 4.5h4.5a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z'

/** Every code block with its bar over it: the language at the start, a copy button
 *  at the end, labelled `copy` (already in the reader's language and escaped). */
export function withCodeBars(html: string, copy: string): string {
  const label = copy.replace(/[&<>"]/g, (one) => `&#${one.charCodeAt(0)};`)
  const opened = html.replace(BLOCK, (_, language: string | undefined) => {
    const named = language ? ` class="language-${language}"` : ''
    return (
      `<div class="code"><div class="code-bar"><span>${language ?? ''}</span>` +
      `<button type="button" class="code-copy" data-copy title="${label}" aria-label="${label}">` +
      `<svg viewBox="0 0 13 13"><path d="${COPY_PATH}"/></svg></button></div>` +
      `<pre><code${named}>`
    )
  })
  return opened === html ? html : opened.replace(/<\/code><\/pre>/g, '</code></pre></div>')
}

/** Every picture in the answer: one of the reader's own as the note would draw it,
 *  against `from`, the note the answer is about; one from elsewhere held behind a
 *  button that shows it, unless `shown` already holds its address. */
function pictures(html: string, from: string | null, shown: ReadonlySet<string>): string {
  return html.replace(PICTURE, (whole, attributes: string) => {
    const src = /\bsrc="([^"]*)"/.exec(attributes)?.[1] ?? ''
    if (!src) return ''
    if (!ELSEWHERE.test(src)) {
      if (/^data:/i.test(src)) return whole
      return `<img${attributes.replace(`src="${src}"`, () => `src="${escape(notePicture(src, from, ''))}"`)}>`
    }
    if (shown.has(src)) return whole
    const alt = /\balt="([^"]*)"/.exec(attributes)?.[1] ?? ''
    const host = /^(?:[a-z][a-z\d+.-]*:)?\/\/([^/?#]+)/i.exec(src)?.[1] ?? src
    return (
      `<button type="button" class="picture-held" data-picture="${src}" title="${src}">` +
      `<svg viewBox="0 0 13 13"><path d="${PICTURE_PATH}"/></svg><span>${alt || host}</span></button>`
    )
  })
}

/** The held picture's glyph: a frame with a hill and a sun in it. */
const PICTURE_PATH =
  'M2.5 2.5h8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zM2 9l2.8-2.8 2 2 1.4-1.4L11 9.5M8.8 5.2h.01'

export interface AnswerOptions {
  /** Where a `[[wikilink]]` in the answer points. */
  resolveLink?: LinkResolver
  /** The code block's copy button's label, in the reader's language; none draws no bar. */
  copy?: string
  /** The words are still arriving. */
  live?: boolean
  /** The note the answer is about, which its pictures are found beside. */
  from?: string | null
  /** The addresses of the pictures from elsewhere the reader has asked to see. */
  shown?: ReadonlySet<string>
}

export function answerHtml(markdown: string, options: AnswerOptions = {}): string {
  const render: RenderOptions = { escapeHtml: true }
  if (options.resolveLink) render.resolveLink = options.resolveLink
  const html = pictures(
    viewHtml(markdown, render, { live: options.live === true }).replace(MEDIA, ''),
    options.from ?? null,
    options.shown ?? new Set(),
  )
  return options.copy ? withCodeBars(html, options.copy) : html
}
