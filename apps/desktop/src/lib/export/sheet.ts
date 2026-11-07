import { assetsOf, printInFrame, printsInFrame } from '../export'
import type { PaperInches } from '../page-setup'
import { assetPath, invoke, isNative } from '../tauri'
import { toBase64 } from '../bytes'
import { mimeOf, type Picture } from './pictures'

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

export function pageWith(html: string, pictures: readonly Picture[]): Blob {
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
      const picture = await pictureOf(resolve(src), mimeOf(src))
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
