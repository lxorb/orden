import type { RenderOptions } from '@orden/markdown'
import { escape } from '@orden/markdown/html'
import { viewHtml } from '../../markdown-view.svelte'
import { notePicture } from '../../note-images'

type LinkResolver = NonNullable<RenderOptions['resolveLink']>

const MEDIA = /<(?:iframe|video|audio|source|picture|object|embed)\b[^>]*>/gi

const PICTURE = /<img\b([^>]*)>/gi

const ELSEWHERE = /^(?:[a-z][a-z\d+.-]*:)?\/\//i

const BLOCK = /<pre><code(?: class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g

const COPY_PATH =
  'M4.5 4.5V3a1 1 0 0 1 1-1H10a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H8.5M3 4.5h4.5a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z'

function linesIn(code: string): number {
  let lines = 0
  for (let at = code.indexOf('\n'); at !== -1; at = code.indexOf('\n', at + 1)) lines++
  return code.endsWith('\n') ? Math.max(lines, 1) : lines + 1
}

export function withCodeBars(html: string, copy: string, sized = false): string {
  const label = copy.replace(/[&<>"]/g, (one) => `&#${one.charCodeAt(0)};`)
  return html.replace(BLOCK, (_, language: string | undefined, code: string) => {
    const named = language ? ` class="language-${language}"` : ''
    const size = sized ? ` style="--lines: ${String(linesIn(code))}"` : ''
    return (
      `<div class="code"${size}><div class="code-bar"><span>${language ?? ''}</span>` +
      `<button type="button" class="code-copy" data-copy title="${label}" aria-label="${label}">` +
      `<svg viewBox="0 0 13 13"><path d="${COPY_PATH}"/></svg></button></div>` +
      `<pre><code${named}>${code}</code></pre></div>`
    )
  })
}

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

const PICTURE_PATH =
  'M2.5 2.5h8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zM2 9l2.8-2.8 2 2 1.4-1.4L11 9.5M8.8 5.2h.01'

export interface AnswerOptions {
  resolveLink?: LinkResolver
  copy?: string
  live?: boolean
  from?: string | null
  shown?: ReadonlySet<string>
}

export const LINES_A_GROUP = 50

const CODE_INSIDE = /(<pre><code[^>]*>)([\s\S]*?)(<\/code><\/pre>)/g

function openSpan(html: string): string {
  const opened = html.lastIndexOf('<span')
  if (opened === -1 || opened < html.lastIndexOf('</span>')) return ''
  return html.slice(opened, html.indexOf('>', opened) + 1)
}

function lineGroups(code: string): string {
  let out = ''
  let from = 0
  let lines = 0
  let carried = ''
  const group = (to: number) => {
    const piece = carried + code.slice(from, to)
    carried = openSpan(piece)
    out += `<span class="code-lines">${piece}${carried ? '</span>' : ''}</span>`
    from = to
  }

  for (let at = code.indexOf('\n'); at !== -1; at = code.indexOf('\n', at + 1)) {
    if (++lines % LINES_A_GROUP === 0) group(at + 1)
  }
  if (lines < LINES_A_GROUP) return code
  if (from < code.length) group(code.length)
  return out
}

export function inLineGroups(html: string): string {
  return html.replace(
    CODE_INSIDE,
    (_, open: string, code: string, close: string) => open + lineGroups(code) + close,
  )
}

export function answerHtml(markdown: string, options: AnswerOptions = {}): string {
  const render: RenderOptions = { escapeHtml: true }
  if (options.resolveLink) render.resolveLink = options.resolveLink
  const drawn = pictures(
    viewHtml(markdown, render, { live: options.live === true }).replace(MEDIA, ''),
    options.from ?? null,
    options.shown ?? new Set(),
  )
  const html = options.live ? inLineGroups(drawn) : drawn
  return options.copy ? withCodeBars(html, options.copy, !options.live) : html
}
