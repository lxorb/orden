import { sourcesOf } from '@orden/markdown/sources'
import { fileBytes, mimeOfPath, parseDataUri, toBase64, isReserved } from '../../platform/src/api'
import { claimName, swapSources } from '../../files-out/src/api'

export interface Picture {
  src: string
  name: string
  mime: string
  bytes: Uint8Array
}

const SUFFIXES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
}

export function isRemote(src: string): boolean {
  return /^([a-z][a-z0-9+.-]*:)?\/\//i.test(src)
}

export function mimeOf(src: string, fallback = 'image/png'): string {
  const found = mimeOfPath(src)
  return found?.startsWith('image/') ? found : fallback
}

export function suffixFor(mime: string): string {
  return SUFFIXES[mime] ?? 'png'
}

const MEDIA_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/

function declaredMime(value: string | null | undefined): string | null {
  const type = value?.split(';')[0]?.trim() ?? ''
  return type.startsWith('image/') && MEDIA_TYPE.test(type) ? type : null
}

function baseName(src: string): string {
  const path = src.split(/[?#]/)[0] ?? src

  const decoded = (() => {
    try {
      return decodeURIComponent(path)
    } catch {
      return path
    }
  })()

  const last = decoded.split(/[\\/:]/).pop() ?? ''
  return /^\.*$/.test(last) ? '' : last
}

async function remoteBytes(src: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const response = await fetch(src).catch(() => null)
  if (!response?.ok) return null

  const buffer = await response.arrayBuffer().catch(() => null)
  if (!buffer) return null

  const mime = declaredMime(response.headers.get('content-type')) ?? mimeOf(src)

  return { mime, bytes: new Uint8Array(buffer) }
}

export type Resolve = (src: string) => string

export async function readPictures(
  sources: readonly string[],
  resolve?: Resolve,
): Promise<Picture[]> {
  const read = await Promise.all(
    sources.map(async (src): Promise<Omit<Picture, 'name'> | null> => {
      const inline = parseDataUri(src)
      if (inline) return { src, ...inline, mime: declaredMime(inline.mime) ?? mimeOf(src) }

      if (isRemote(src)) {
        const fetched = await remoteBytes(src)
        return fetched ? { src, ...fetched } : null
      }

      if (!resolve) return null

      const bytes = await fileBytes(resolve(src)).catch(() => null)
      return bytes?.length ? { src, mime: mimeOf(src), bytes } : null
    }),
  )

  const taken = new Set<string>()

  return read
    .filter((one): one is Omit<Picture, 'name'> => one !== null)
    .map((one) => {
      const named = baseName(one.src)
      const usable = /\.[a-z0-9]+$/i.test(named) && !isReserved(named)
      const wanted = usable ? named : `picture.${suffixFor(one.mime)}`
      return { ...one, name: claimName(wanted, taken) }
    })
}

export function inlinePictures(html: string, pictures: readonly Picture[]): string {
  return swapSources(
    html,
    new Map(pictures.map((one) => [one.src, `data:${one.mime};base64,${toBase64(one.bytes)}`])),
  )
}

export function sourcesIn(html: string): string[] {
  return sourcesOf(html, (src) => !src.startsWith('data:'))
}
