import { escapeAll } from '@orden/markdown/html'
import {
  DECK_HEIGHT,
  DECK_LAYOUT_SCRIPT,
  DECK_PAGE_CSS,
  DECK_SCRIPT,
  DECK_WIDTH,
  deckBody,
} from '@orden/markdown/deck'
import { CODE_PALETTES } from '@orden/editor'
import { proseCss, slidesCss, tokensCss } from '@orden/themes/raw'
import { accentTokens, DEFAULT_ACCENT } from '../accents'
import { pageBytes } from '../bytes'
import { writtenPdf } from '../export/print'
import { printWithPictures, wholeSheet } from '../export/sheet'
import { titleOf } from '../export/document'
import { chooseTarget, download, writeFile } from '../export/save'
import { mathCss } from '../math-fonts'
import { paletteCss } from '../highlight'
import type { StageSlide } from './render'
import { invoke, isDesktop } from '../tauri'
import type { Scheme } from '../theme.svelte'

interface Note {
  text: string
  path: string | null
  trusted: boolean
}

interface DeckOptions {
  scheme?: Scheme
  accent?: string
  codeTheme?: string
  css?: string
  interactive?: boolean
}

export const DECK_PAPER = {
  width: DECK_WIDTH / 96,
  height: DECK_HEIGHT / 96,
  margin: 0,
  landscape: false,
}

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

function freshNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function declarations(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([token, value]) => `${token}: ${value};`)
    .join(' ')
}

export function buildDeckHtml(
  slides: readonly StageSlide[],
  title: string,
  options: DeckOptions = {},
): string {
  const body = deckBody(slides)
  const scheme = options.scheme ?? 'dark'
  const palette =
    CODE_PALETTES.find((entry) => entry.id === options.codeTheme) ?? CODE_PALETTES.at(0)

  const styles = [
    mathCss(body),
    tokensCss,
    `:root { ${declarations(accentTokens(options.accent ?? DEFAULT_ACCENT, scheme))} }`,
    proseCss,
    slidesCss,
    `@page { size: ${DECK_WIDTH}px ${DECK_HEIGHT}px; margin: 0; }`,
    `.deck .stage { --stage-width: ${DECK_WIDTH}px; --stage-height: ${DECK_HEIGHT}px; }`,
    DECK_PAGE_CSS,
    palette ? paletteCss(palette) : '',
    options.css ?? '',
  ]
    .filter(Boolean)
    .join('\n')

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

export type DeckExport = DeckOptions & { resolveImage?: (src: string) => string }

async function deckPage(note: Note, name: string, options: DeckExport): Promise<string> {
  const { deckHtml } = await import('./render')

  const slides = await deckHtml(note, options.scheme ?? 'dark', note.trusted)
  return buildDeckHtml(slides, titleOf(note.text, name), options)
}

export async function exportDeck(
  note: Note,
  name: string,
  options: DeckExport = {},
): Promise<string | undefined> {
  const whole = await wholeSheet(await deckPage(note, name, options), options.resolveImage)
  const file = `${name.replace(/\.[^.]+$/, '')}.html`

  if (!isDesktop) {
    download(file, { pieces: new Blob([whole], { type: 'text/html' }) })
    return file
  }

  const target = await chooseTarget(name, 'html', 'HTML')
  if (!target) return

  await writeFile(target, await pageBytes(whole))
  return target
}

export async function exportDeckPdf(
  note: Note,
  name: string,
  options: DeckExport = {},
): Promise<string | undefined> {
  const native = isDesktop && (await invoke<boolean>('pdf_supported').catch(() => false))
  const target = native ? await chooseTarget(name, 'pdf', 'PDF') : null
  if (native && !target) return

  const printed = { ...options, interactive: false }

  const html = await deckPage(note, name, printed)

  if (target) {
    const whole = await wholeSheet(html, options.resolveImage)
    if (await writtenPdf(whole, target, DECK_PAPER)) return target
  }

  await printWithPictures(html, options.resolveImage, DECK_PAPER)
  return
}
