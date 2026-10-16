/** A deck written out as a file.
 *
 *  One HTML file that holds the whole talk: the slides, the theme, the fonts the
 *  maths needs and the pictures, with nothing to fetch. A deck can be emailed
 *  and opened, and it turns its own pages.
 *
 *  The same file is what becomes a PDF. Without the script every slide is simply
 *  on the page and the print rules in slides.css give each of them a sheet of
 *  its own at the stage's size, so one route builds both.
 */

import { escapeAll } from '@nib/markdown/html'
import {
  DECK_HEIGHT,
  DECK_LAYOUT_SCRIPT,
  DECK_PAGE_CSS,
  DECK_SCRIPT,
  DECK_WIDTH,
  deckBody,
} from '@nib/markdown/deck'
import { CODE_PALETTES } from '@nib/editor'
import { proseCss, slidesCss, tokensCss } from '@nib/themes/raw'
import { accentTokens, DEFAULT_ACCENT } from '../accents'
import { inlineImages, printInFrame } from '../export'
import { writtenPdf } from '../export/print'
import { titleOf } from '../export/document'
import { chooseTarget, download } from '../export/save'
import { mathCss } from '../math-fonts'
import { paletteCss } from '../highlight'
import type { StageSlide } from './render'
import { invoke, isDesktop } from '../tauri'
import type { Scheme } from '../theme.svelte'

/** The note a deck is built from, and where it lives so its pictures and its
 *  links resolve. The same shape the reading view reads. */
interface Note {
  text: string
  path: string | null
  /** Whether the note's raw HTML is markup, asked of the document the way the
   *  reading view and the presenter ask it; see trust.ts and `openTarget` in
   *  export/context.ts. A deck of somebody else's words is still their words. */
  trusted: boolean
}

interface DeckOptions {
  /** The colours the deck wears. */
  scheme?: Scheme
  accent?: string
  codeTheme?: string
  /** A theme file and custom.css, when the deck should look exactly as the app
   *  does. */
  css?: string
  /** Whether the file turns its own pages. A deck on its way to a printer does
   *  not: every slide is on the page and the print rules give each a sheet. */
  interactive?: boolean
}

/** Paper the size of the stage, in inches, so a printed slide is the slide. CSS
 *  pixels are ninety-sixths of an inch by definition.
 *
 *  All four fields, because the command on the other side takes all four: see
 *  PdfPage in src-tauri/src/pdf.rs. The sheet is already wider than it is tall,
 *  so it is not turned, and a slide reaches its own edges, so there is no
 *  margin. */
export const DECK_PAPER = {
  width: DECK_WIDTH / 96,
  height: DECK_HEIGHT / 96,
  margin: 0,
  landscape: false,
}

/** What a deck file may do: draw itself, and run the one script it was written
 *  with. The page is opened in whatever browser the reader has, and printed in a
 *  hidden window of the app's own, and neither should run anything a note put in
 *  it. The deck's script is let in by a nonce made for this file alone; its styles
 *  are inline, and its fonts and pictures are `data:` addresses by the time it is
 *  written. The same rule an exported note carries; see export.ts. */
function contentPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "style-src * 'unsafe-inline'",
    'img-src * data: blob:',
    'media-src * data: blob:',
    'font-src * data:',
  ].join('; ')
}

/** A nonce nobody can guess from the note, so a script a slide carries is not the
 *  deck's. */
function freshNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function declarations(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([token, value]) => `${token}: ${value};`)
    .join(' ')
}

/** The whole file. Pure, so the page splitting can be tested without a browser;
 *  the slides are rendered before it is called. */
export function buildDeckHtml(
  slides: readonly StageSlide[],
  title: string,
  options: DeckOptions = {},
): string {
  const body = deckBody(slides)
  const scheme = options.scheme ?? 'dark'
  // The first palette is the one that follows the theme, and stands in for an id
  // nothing here recognises - one written by a later build, say.
  const palette =
    CODE_PALETTES.find((entry) => entry.id === options.codeTheme) ?? CODE_PALETTES.at(0)

  const styles = [
    mathCss(body),
    tokensCss,
    `:root { ${declarations(accentTokens(options.accent ?? DEFAULT_ACCENT, scheme))} }`,
    // The prose sheets and nothing else: base.css dresses the words and
    // document.css the constructs only the renderer makes - a real checkbox,
    // coloured code, a framed diagram, an embedded note. The running header and
    // footer an exported document carries have no place on a slide.
    proseCss,
    slidesCss,
    // A page whose whole size is the stage, rather than a stage over an app.
    `@page { size: ${DECK_WIDTH}px ${DECK_HEIGHT}px; margin: 0; }`,
    `.deck .stage { --stage-width: ${DECK_WIDTH}px; --stage-height: ${DECK_HEIGHT}px; }`,
    DECK_PAGE_CSS,
    palette ? paletteCss(palette) : '',
    options.css ?? '',
  ]
    .filter(Boolean)
    .join('\n')

  // A deck on its way to a printer turns no pages, but it still has to lay
  // itself out: every slide gets a sheet of its own and none of them was ever on
  // screen to be measured, so the one that has to shrink would be cut off.
  const running = options.interactive === false ? DECK_LAYOUT_SCRIPT : DECK_SCRIPT
  const nonce = freshNonce()
  const script = `<script nonce="${nonce}">${running}</script>\n`

  return `<!doctype html>
<html lang="en" data-theme="${scheme}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${contentPolicy(nonce)}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="Orden">
<title>${escapeAll(title)}</title>
<style>
${styles}
</style>
</head>
<body class="deck-page">
${body}
${script}</body>
</html>
`
}

/** Everything a deck on its way out of the app needs beyond the note. */
export type DeckExport = DeckOptions & { resolveImage?: (src: string) => string }

/** The deck, rendered and written out, with its pictures inside it. Both of the
 *  routes out of the app go through here: one saves the file, the other hands it
 *  to a printer. */
async function renderDeck(note: Note, name: string, options: DeckExport): Promise<string> {
  // Asked for here rather than at the top, so building the page - which is all
  // arithmetic and string work - needs nothing of the running app around it.
  const { deckHtml } = await import('./render')

  // The same question the presenter asks of the same note: a file of somebody
  // else's words is not made trustworthy by being saved or printed. See trust.ts.
  const slides = await deckHtml(note, options.scheme ?? 'dark', note.trusted)
  const html = buildDeckHtml(slides, titleOf(note.text, name), options)

  return options.resolveImage ? inlineImages(html, options.resolveImage) : html
}

/** One file holding the whole talk. */
export async function exportDeck(
  note: Note,
  name: string,
  options: DeckExport = {},
): Promise<string | undefined> {
  const html = await renderDeck(note, name, options)
  const file = `${name.replace(/\.[^.]+$/, '')}.html`

  if (!isDesktop) {
    download(file, { text: html, mime: 'text/html' })
    return file
  }

  const target = await chooseTarget(name, 'html', 'HTML')
  if (!target) return

  await invoke('write_note', { path: target, content: html })
  return target
}

/** One page per slide, at the stage's size. No script, so every slide is on the
 *  page and the print rules give each of them a sheet; see slides.css. */
export async function exportDeckPdf(
  note: Note,
  name: string,
  options: DeckExport = {},
): Promise<string | undefined> {
  const native = isDesktop && (await invoke<boolean>('pdf_supported').catch(() => false))
  const target = native ? await chooseTarget(name, 'pdf', 'PDF') : null
  if (native && !target) return

  const html = await renderDeck(note, name, { ...options, interactive: false })

  if (target) {
    // The dialog can still save the file, so the person is not left with nothing -
    // and the line says the road changed; see export/print.ts.
    if (await writtenPdf(html, target, DECK_PAPER)) return target
  }

  await printInFrame(html, DECK_PAPER)
  return
}
