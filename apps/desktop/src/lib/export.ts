import { escapeAll } from '@orden/markdown/html'
import { CODE_PALETTES } from '@orden/editor'
import { type EmbeddedNote, frontMatterValue, renderMarkdown, type Wikilink } from '@orden/markdown'
import { sourcesOf } from '@orden/markdown/sources'
import { exportCss, themeCss } from '@orden/themes/raw'
import { accentTokens, DEFAULT_ACCENT } from './accents'
import { busy } from './busy.svelte'
import { pageBytes } from './bytes'
import { type Fence, prepareEmbeds, prepareFences } from './before-render'
import { titleOf } from './export/document'
import { inlinePictures, type Picture, swapSources } from './export/pictures'
import { chooseTarget } from './export/save'
import { PANDOC_FORMATS, type PandocFormat } from './export-formats'
import type { PandocPicture } from './import/pandoc-pictures'
import { paletteCss } from './highlight'
import { plural } from './i18n.svelte'
import { mathCss } from './math-fonts'
import { type PaperInches, pageCss, pageSetupFor, runningDate, withRunningText } from './page-setup'
import { DEFAULT_PAGE_SETUP, type PageSetup } from './paper'
import { assetPath, invoke, isDesktop, platform } from './tauri'
import type { Scheme } from './theme.svelte'

export { PANDOC_FORMATS, type PandocFormat } from './export-formats'
export { type Drawer, type Fence, prepareEmbeds, prepareFences } from './before-render'

export interface HtmlOptions {
  bare?: boolean
  resolveImage?: (src: string) => string
  scheme?: Scheme
  accent?: string
  codeTheme?: string
  css?: string
  page?: PageSetup
  date?: string
  fence?: Fence
  readNote?: (target: string) => Promise<string | EmbeddedNote | null>
  embed?: (link: Wikilink) => string | EmbeddedNote | null
  escapeHtml?: boolean
}

const contentPolicy = (pictures: string) =>
  [
    "default-src 'none'",
    "script-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "style-src * 'unsafe-inline'",
    `img-src * data: blob:${pictures}`,
    `media-src * data: blob:${pictures}`,
    'font-src * data:',
  ].join('; ')

const CONTENT_POLICY = contentPolicy('')

export const SHEET_POLICY = contentPolicy(' asset: http://asset.localhost')

function declarations(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([token, value]) => `${token}: ${value};`)
    .join(' ')
}

function accentCss(accent: string, scheme: Scheme): string {
  return [
    `:root { ${declarations(accentTokens(accent, scheme))} }`,
    `@media print { :root { ${declarations(accentTokens(accent, 'light'))} } }`,
  ].join('\n')
}

export function buildBody(source: string, options: HtmlOptions = {}): string {
  return renderMarkdown(source, {
    footnotes: true,
    toc: true,
    cover: true,
    ...(options.fence ? { code: options.fence } : {}),
    ...(options.embed ? { resolveEmbed: options.embed } : {}),
    ...(options.escapeHtml ? { escapeHtml: true } : {}),
  })
}

export function buildStyles(body: string, source: string, options: HtmlOptions = {}): string {
  const palette =
    CODE_PALETTES.find((entry) => entry.id === options.codeTheme) ?? CODE_PALETTES.at(0)

  return [
    mathCss(body),
    themeCss,
    accentCss(options.accent ?? DEFAULT_ACCENT, options.scheme ?? 'light'),
    exportCss,
    palette ? paletteCss(palette) : '',
    pageCss(pageSetupFor(source, options.page ?? DEFAULT_PAGE_SETUP)),
    options.css ?? '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildHtml(source: string, name: string, options: HtmlOptions = {}): string {
  const title = titleOf(source, name)
  const author = frontMatterValue(source, 'author')
  const lang = frontMatterValue(source, 'lang') ?? 'en'
  const body = buildBody(source, options)

  const meta = [
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CONTENT_POLICY}">`,
    author ? `<meta name="author" content="${escapeAll(author)}">` : '',
    `<title>${escapeAll(title)}</title>`,
  ]
    .filter(Boolean)
    .join('\n')

  if (options.bare) {
    return `<!doctype html>\n<html lang="${escapeAll(lang)}">\n<head>\n${meta}\n</head>\n<body>\n${body}</body>\n</html>\n`
  }

  const scheme = options.scheme ?? 'light'
  const setup = pageSetupFor(source, options.page ?? DEFAULT_PAGE_SETUP)
  const date = runningDate(source, options.date)

  const styles = buildStyles(body, source, options)
  const page = withRunningText(`<div id="write">\n${body}</div>\n`, setup, title, date)

  return `<!doctype html>
<html lang="${escapeAll(lang)}" data-theme="${scheme}">
<head>
${meta}
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="Orden">
<style>
${styles}
</style>
</head>
<body>
${page}</body>
</html>
`
}

export function localSources(html: string): string[] {
  return sourcesOf(html, (src) => assetPath(src) !== null || !/^(data:|https?:|\/\/)/i.test(src))
}

export async function inlineImages(
  html: string,
  resolve: (src: string) => string,
): Promise<string> {
  const sources = localSources(html)
  if (!sources.length) return html

  return swapSources(html, await assetsOf(sources, resolve))
}

export async function assetsOf(
  sources: readonly string[],
  resolve: (src: string) => string,
): Promise<Map<string, string>> {
  const inlined = new Map<string, string>()

  await Promise.all(
    sources.map(async (src) => {
      const data = await invoke<string>('read_asset', { path: resolve(src) }).catch(() => null)
      if (data) inlined.set(src, data)
    }),
  )

  return inlined
}

export async function renderNote(
  source: string,
  name: string,
  options: HtmlOptions = {},
  pictures?: readonly Picture[],
): Promise<string> {
  const fence = await prepareFences(source, options.scheme ?? 'light', { highlight: !options.bare })
  const embed = options.readNote ? await prepareEmbeds(source, options.readNote) : undefined
  const html = buildHtml(source, name, { ...options, fence, ...(embed ? { embed } : {}) })

  if (options.bare) return html
  if (pictures) return inlinePictures(html, pictures)

  return options.resolveImage ? inlineImages(html, options.resolveImage) : html
}

export function printsInFrame(): boolean {
  return !(isDesktop && platform() === 'macos')
}

export function printInFrame(html: string | Blob, page?: PaperInches): Promise<void> {
  if (!printsInFrame()) {
    return pageBytes(html)
      .then((bytes) => invoke('print_page', { bytes, page: page ?? null }))
      .then(
        () => undefined,
        () => undefined,
      )
  }

  return new Promise((resolve) => {
    const from = document.activeElement

    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;'

    const link = typeof html === 'string' ? null : URL.createObjectURL(html)

    let done = false
    const finish = () => {
      if (done) return
      done = true

      const ours = document.activeElement === frame
      frame.remove()
      if (link) URL.revokeObjectURL(link)
      if (ours && from instanceof HTMLElement && from.isConnected) from.focus()

      resolve()
    }

    const show = async () => {
      const inner = frame.contentWindow
      if (!inner) {
        finish()
        return
      }

      await inner.document.fonts.ready.catch(() => undefined)
      inner.addEventListener('afterprint', finish, { once: true })
      inner.focus()
      inner.print()
      window.setTimeout(finish, 5 * 60 * 1000)
    }

    frame.addEventListener('load', () => void show().catch(finish))

    if (link) frame.src = link
    else if (typeof html === 'string') frame.srcdoc = html
    document.body.append(frame)
  })
}

export async function pandocAvailable(): Promise<boolean> {
  if (!isDesktop) return false
  return invoke<boolean>('has_pandoc').catch(() => false)
}

export async function importDocument(): Promise<{
  name: string
  markdown: string
  pictures: PandocPicture[]
} | null> {
  if (!isDesktop) return null

  const { open } = await import('@tauri-apps/plugin-dialog')
  const given = (await import('./dialog-answer')).dialogAnswer()
  const picked = given
    ? await given(false)
    : await open({
        filters: [
          {
            name: 'Documents',
            extensions: [
              'docx',
              'odt',
              'rtf',
              'epub',
              'rst',
              'textile',
              'tex',
              'html',
              'opml',
              'org',
            ],
          },
        ],
      })

  if (typeof picked !== 'string') return null

  const { markdown, leftOut, pictures } = await invoke<{
    markdown: string
    leftOut: string | null
    pictures: PandocPicture[]
  }>('import_document', { path: picked })
  if (leftOut) busy.failed(leftOut)
  const name =
    picked
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, '') ?? 'Imported'

  return { name: `${name}.md`, markdown, pictures }
}

export async function exportPandoc(
  source: string,
  name: string,
  format: PandocFormat,
  note: string | null = null,
) {
  if (!isDesktop || __EVEN_PLUGIN__) return

  const spec = PANDOC_FORMATS.find((entry) => entry.id === format)
  if (!spec) return

  const target = await chooseTarget(name, spec.extension, spec.label)
  if (!target) return

  const { diskPathOf } = await import('./internal/work')
  const missing = await invoke<string[]>('run_pandoc', {
    source,
    output: target,
    format,
    note: note === null ? null : await diskPathOf(note),
  })
  if (missing.length) {
    busy.failed(
      plural(missing.length, {
        one: '{count} attachment was missing from the export or could not be read',
        other: '{count} attachments were missing from the export or could not be read',
      }),
    )
  }
  return target
}
