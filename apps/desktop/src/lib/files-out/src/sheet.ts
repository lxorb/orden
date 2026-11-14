import { mapSources, sourcesOf } from '@orden/markdown/sources'
import { busy } from '../../ui-kit/src/api'
import {
  assetPath,
  invoke,
  isNative,
  mimeOfPath,
  pageBytes,
  toBase64,
} from '../../platform/src/api'
import { type PaperInches, printInFrame, printsInFrame } from './frame'

interface Placed {
  src: string
  mime: string
  bytes: Uint8Array
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

export const CONTENT_POLICY = contentPolicy('')

export const SHEET_POLICY = contentPolicy(' asset: http://asset.localhost')

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

export function swapSources(html: string, wanted: ReadonlyMap<string, string>): string {
  if (!wanted.size) return html

  return mapSources(html, (src) => wanted.get(src) ?? null)
}

export async function writtenPdf(
  html: string | Blob,
  target: string,
  page: PaperInches,
): Promise<boolean> {
  try {
    await invoke('print_pdf', { bytes: await pageBytes(html), output: target, page })
    return true
  } catch {
    busy.failed('The file could not be written, so it goes to the print dialog')
    return false
  }
}

const PLACED = /(<(?:img|audio|video|source)\b[^>]*?\bsrc="|<image\b[^>]*?\bhref=")([^"]*)(")/g

const AWAY = /^(?:data:|blob:|https?:|\/\/)/i

function localOf(html: string): string[] {
  const found = new Set<string>()
  for (const match of html.matchAll(PLACED)) {
    const src = match[2] ?? ''
    if (src && (assetPath(src) !== null || !AWAY.test(src))) found.add(src)
  }
  return [...found]
}

function placed(html: string, wanted: ReadonlyMap<string, string | Blob>): (string | Blob)[] {
  const pieces: (string | Blob)[] = []
  let from = 0
  for (const match of html.matchAll(PLACED)) {
    const src = match[2] ?? ''
    const put = wanted.get(src)
    if (put === undefined) continue
    const at = match.index + (match[1]?.length ?? 0)
    pieces.push(html.slice(from, at), put)
    from = at + src.length
  }
  pieces.push(html.slice(from))
  return pieces
}

export function pageWith(html: string, pictures: readonly Placed[]): Blob {
  const wanted = new Map(
    pictures.map((one) => [one.src, new Blob([`data:${one.mime};base64,`, toBase64(one.bytes)])]),
  )
  return new Blob(placed(html, wanted), { type: 'text/html' })
}

function swapped(html: string, links: ReadonlyMap<string, string>): string {
  return html.replace(PLACED, (whole: string, before: string, src: string, after: string) => {
    const link = links.get(src)
    return link === undefined ? whole : `${before}${link}${after}`
  })
}

async function pictureOf(path: string, mime: string): Promise<Blob | null> {
  if (isNative) {
    const bytes = await invoke<ArrayBuffer>('read_file', { path }).catch(() => null)
    return bytes?.byteLength ? new Blob([bytes], { type: mime }) : null
  }

  const data = await invoke<string>('read_asset', { path }).catch(() => null)
  if (!data) return null
  const picture = await fetch(data)
    .then((answer) => answer.blob())
    .catch(() => null)
  return picture?.size ? picture : null
}

async function linked(
  sources: readonly string[],
  resolve: (src: string) => string,
): Promise<Map<string, string>> {
  const links = new Map<string, string>()
  await Promise.all(
    sources.map(async (src) => {
      const picture = await pictureOf(resolve(src), mimeOfPath(src) ?? 'image/png')
      if (picture) links.set(src, URL.createObjectURL(picture))
    }),
  )
  return links
}

async function inlined(
  sources: readonly string[],
  resolve: (src: string) => string,
): Promise<Map<string, Blob>> {
  const found = await assetsOf(sources, resolve)
  return new Map([...found].map(([src, data]) => [src, new Blob([data])]))
}

export async function wholeSheet(
  html: string,
  resolve: ((src: string) => string) | undefined,
): Promise<string | Blob> {
  const sources = resolve ? localOf(html) : []
  if (!resolve || !sources.length) return html

  return new Blob(placed(html, await inlined(sources, resolve)), { type: 'text/html' })
}

export async function printWithPictures(
  html: string,
  resolve: ((src: string) => string) | undefined,
  page?: PaperInches,
): Promise<void> {
  const sources = resolve ? localOf(html) : []
  if (!resolve || !sources.length) {
    await printInFrame(html, page)
    return
  }

  if (!printsInFrame()) {
    await printInFrame(await wholeSheet(html, resolve), page)
    return
  }

  const links = await linked(sources, resolve)
  try {
    await printInFrame(swapped(html, links), page)
  } finally {
    for (const link of links.values()) URL.revokeObjectURL(link)
  }
}
