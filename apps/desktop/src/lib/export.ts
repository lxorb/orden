import { CODE_PALETTES, DIAGRAM_LANGUAGES } from '@nib/editor'
import { codeBlocks, documentTitle, frontMatterValue, renderMarkdown } from '@nib/markdown'
import { exportCss, themeCss } from '@nib/themes/raw'
import { accentTokens, DEFAULT_ACCENT } from './accents'
import { drawDiagram } from './diagrams'
import { PANDOC_FORMATS, type PandocFormat } from './export-formats'
import { highlightCode, loadParsers, paletteCss } from './highlight'
import { mathCss } from './math-fonts'
import {
  DEFAULT_PAGE_SETUP,
  type PageSetup,
  pageCss,
  pageSetupFor,
  paperInches,
  withRunningText,
} from './page-setup'
import { invoke, isDesktop } from './tauri'
import type { Scheme } from './theme.svelte'

export { PANDOC_FORMATS, type PandocFormat } from './export-formats'

function escape(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]!,
  )
}

/** A fence already drawn or coloured: the HTML for the whole block, or null
 *  to leave it as plain code. */
export type Fence = (code: string, language: string) => string | null

export interface HtmlOptions {
  /** Leave the stylesheet out, for pasting into a site that has its own. The
   *  markup stays semantic: no colouring spans, and images keep the paths the
   *  note wrote. Diagrams are still drawn, since they are content. */
  bare?: boolean
  /** Turns a path written in the note into one the filesystem understands. */
  resolveImage?: (src: string) => string
  /** Light unless asked otherwise: a document is read on paper more often
   *  than a screen, and the print stylesheet turns light regardless. */
  scheme?: Scheme
  /** The accent and code palette chosen in the app. */
  accent?: string
  codeTheme?: string
  /** Stylesheets on top of the built-in theme: a theme file and custom.css,
   *  when the export should look exactly as the app does. */
  css?: string
  /** Paper and running text. The note's own front matter wins over this. */
  page?: PageSetup
  /** The date the running text prints. Passed in so a build is reproducible. */
  date?: string
  /** Fences already prepared; see `prepareFences`. */
  fence?: Fence
}

function declarations(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([token, value]) => `${token}: ${value};`)
    .join(' ')
}

/** The accent for the scheme on screen, and its light shade on paper. */
function accentCss(accent: string, scheme: Scheme): string {
  return [
    `:root { ${declarations(accentTokens(accent, scheme))} }`,
    `@media print { :root { ${declarations(accentTokens(accent, 'light'))} } }`,
  ].join('\n')
}

/** What the running text calls the document: the front matter's title, else
 *  the first heading, else the file's name. */
export function titleOf(source: string, name: string): string {
  return frontMatterValue(source, 'title') ?? documentTitle(source) ?? name.replace(/\.[^.]+$/, '')
}

/** A standalone page: the note, its theme, and nothing else. Pure, so it can
 *  be tested; the fences are drawn beforehand by `prepareFences`. */
export function buildHtml(source: string, name: string, options: HtmlOptions = {}): string {
  const title = titleOf(source, name)
  const author = frontMatterValue(source, 'author')
  const lang = frontMatterValue(source, 'lang') ?? 'en'
  const body = renderMarkdown(source, { footnotes: true, toc: true, code: options.fence })

  const meta = [
    '<meta charset="utf-8">',
    author ? `<meta name="author" content="${escape(author)}">` : '',
    `<title>${escape(title)}</title>`,
  ]
    .filter(Boolean)
    .join('\n')

  if (options.bare) {
    return `<!doctype html>\n<html lang="${escape(lang)}">\n<head>\n${meta}\n</head>\n<body>\n${body}</body>\n</html>\n`
  }

  const scheme = options.scheme ?? 'light'
  const setup = pageSetupFor(source, options.page ?? DEFAULT_PAGE_SETUP)
  const date = options.date ?? frontMatterValue(source, 'date') ?? new Date().toISOString().slice(0, 10)
  const palette =
    CODE_PALETTES.find((entry) => entry.id === options.codeTheme) ?? CODE_PALETTES[0]

  const styles = [
    mathCss(body),
    themeCss,
    accentCss(options.accent ?? DEFAULT_ACCENT, scheme),
    exportCss,
    paletteCss(palette),
    pageCss(setup),
    options.css ?? '',
  ]
    .filter(Boolean)
    .join('\n')

  const page = withRunningText(`<div id="write">\n${body}</div>\n`, setup, title, date)

  return `<!doctype html>
<html lang="${escape(lang)}" data-theme="${scheme}">
<head>
${meta}
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="Nib">
<style>
${styles}
</style>
</head>
<body>
${page}</body>
</html>
`
}

export type Drawer = (code: string, language: string, scheme: Scheme) => Promise<string>

/** Draws every diagram and loads a parser for every language the note uses,
 *  so rendering can then picture and colour each fence without waiting. A
 *  diagram that will not draw stays as code, which beats an empty space. */
export async function prepareFences(
  source: string,
  scheme: Scheme,
  options: { highlight?: boolean } = {},
  draw: Drawer = drawDiagram,
): Promise<Fence> {
  const blocks = codeBlocks(source)
  const diagrams = new Map<string, string>()
  const languages = new Set<string>()

  const drawings = blocks
    .filter((block) => DIAGRAM_LANGUAGES.has(block.language))
    .map(async (block) => {
      const svg = await draw(block.code, block.language, scheme).catch(() => null)
      if (svg) diagrams.set(`${block.language}\n${block.code}`, svg)
    })

  for (const block of blocks) {
    if (block.language && !DIAGRAM_LANGUAGES.has(block.language)) languages.add(block.language)
  }

  const [parsers] = await Promise.all([
    options.highlight === false ? new Map() : loadParsers(languages),
    ...drawings,
  ])

  return (code, language) => {
    if (DIAGRAM_LANGUAGES.has(language)) {
      const svg = diagrams.get(`${language}\n${code}`)
      return svg ? `<figure class="diagram" data-language="${language}">${svg}</figure>\n` : null
    }

    const parser = parsers.get(language)
    if (!parser) return null

    return `<pre><code class="language-${escape(language)}">${highlightCode(code, parser)}\n</code></pre>\n`
  }
}

/** Every `src` in the page that points at a file rather than at the network. */
export function localSources(html: string): string[] {
  const found = new Set<string>()

  for (const match of html.matchAll(/<img\b[^>]*?\bsrc="([^"]*)"/g)) {
    const src = match[1]
    if (src && !/^(data:|https?:|\/\/)/i.test(src)) found.add(src)
  }

  return [...found]
}

/** Swaps local image paths for `data:` URIs so the exported file stands alone.
 *  An image that cannot be read is left pointing where it did. */
export async function inlineImages(
  html: string,
  resolve: (src: string) => string,
): Promise<string> {
  const sources = localSources(html)
  if (!sources.length) return html

  const inlined = new Map<string, string>()

  await Promise.all(
    sources.map(async (src) => {
      const data = await invoke<string>('read_asset', { path: resolve(src) }).catch(() => null)
      if (data) inlined.set(src, data)
    }),
  )

  return html.replace(/(<img\b[^>]*?\bsrc=")([^"]*)(")/g, (whole, before, src, after) => {
    const data = inlined.get(src)
    return data ? `${before}${data}${after}` : whole
  })
}

/** The whole document, ready to write: fences drawn, pictures inside it. */
export async function renderNote(source: string, name: string, options: HtmlOptions = {}): Promise<string> {
  const fence = await prepareFences(source, options.scheme ?? 'light', { highlight: !options.bare })
  const html = buildHtml(source, name, { ...options, fence })

  return options.bare || !options.resolveImage ? html : inlineImages(html, options.resolveImage)
}

async function chooseTarget(name: string, extension: string, label: string) {
  const { save } = await import('@tauri-apps/plugin-dialog')
  return save({
    defaultPath: `${name.replace(/\.[^.]+$/, '')}.${extension}`,
    filters: [{ name: label, extensions: [extension] }],
  })
}

/** A browser has no file dialog to offer; the file is handed to it to save. */
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function exportHtml(source: string, name: string, options: HtmlOptions = {}) {
  const file = `${name.replace(/\.[^.]+$/, '')}.html`

  if (!isDesktop) {
    download(file, await renderNote(source, name, options), 'text/html')
    return file
  }

  const target = await chooseTarget(name, 'html', 'HTML')
  if (!target) return

  await invoke('write_note', { path: target, content: await renderNote(source, name, options) })
  return target
}

/** Shows the page to the browser's print dialog, which is where "Save as PDF"
 *  lives when nothing better is available. The frame is kept until the dialog
 *  has closed; taking it away sooner cancels the print in some engines. */
function printInFrame(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;'

    let done = false
    const finish = () => {
      if (done) return
      done = true
      frame.remove()
      resolve()
    }

    frame.addEventListener('load', async () => {
      const inner = frame.contentWindow
      if (!inner) return finish()

      // Fonts arrive inline but still have to be decoded before the page is measured.
      await inner.document.fonts.ready.catch(() => undefined)
      inner.addEventListener('afterprint', finish, { once: true })
      inner.focus()
      inner.print()
      // An engine that never says afterprint would otherwise keep the frame forever.
      window.setTimeout(finish, 5 * 60 * 1000)
    })

    frame.srcdoc = html
    document.body.append(frame)
  })
}

/** Writes a PDF. On a desktop whose webview can print to a file, it goes
 *  straight to disk with the paper from the settings; elsewhere the print
 *  dialog does the saving. Always light: it is going on paper. */
export async function exportPdf(source: string, name: string, options: HtmlOptions = {}) {
  const native = isDesktop && (await invoke<boolean>('pdf_supported').catch(() => false))
  const target = native ? await chooseTarget(name, 'pdf', 'PDF') : null
  if (native && !target) return

  const html = await renderNote(source, name, { ...options, scheme: 'light' })

  if (target) {
    const page = paperInches(pageSetupFor(source, options.page ?? DEFAULT_PAGE_SETUP))
    try {
      await invoke('print_pdf', { html, output: target, page })
      return target
    } catch {
      // The dialog can still save the file, so the person is not left with nothing.
    }
  }

  await printInFrame(html)
}

export async function pandocAvailable(): Promise<boolean> {
  if (!isDesktop) return false
  return invoke<boolean>('has_pandoc').catch(() => false)
}

/** Reads a Word, ODT, EPUB, RST or similar file in as markdown. */
export async function importDocument(): Promise<{ name: string; markdown: string } | null> {
  if (!isDesktop) return null

  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({
    filters: [
      {
        name: 'Documents',
        extensions: ['docx', 'odt', 'rtf', 'epub', 'rst', 'textile', 'tex', 'html', 'opml', 'org'],
      },
    ],
  })

  if (typeof picked !== 'string') return null

  const markdown = await invoke<string>('import_document', { path: picked })
  const name = picked.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'Imported'

  return { name: `${name}.md`, markdown }
}

/** Typora shells out to pandoc for these too; the formats are pandoc's, not ours. */
export async function exportPandoc(source: string, name: string, format: PandocFormat) {
  if (!isDesktop) return

  const spec = PANDOC_FORMATS.find((entry) => entry.id === format)
  if (!spec) return

  const target = await chooseTarget(name, spec.extension, spec.label)
  if (!target) return

  await invoke('run_pandoc', { source, output: target, format })
  return target
}
