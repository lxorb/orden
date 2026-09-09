/** The pictures a note names, fetched once and handed to whichever writer wants
 *  them.
 *
 *  A picture is written three ways across the formats - as bytes in a package,
 *  as hex in an RTF, as a `data:` URI in a page - and read two ways, off the
 *  disk beside the note or over the network. Reading is here; the writing is in
 *  each format's own file.
 *
 *  A picture that cannot be read is left out rather than thrown over: a note
 *  with one dead link still exports, and the export says so by not carrying the
 *  picture, which is exactly what the note itself shows. */

import { mapSources, sourcesOf } from '@nib/markdown/sources'
import { fileBytes, parseDataUri, toBase64 } from '../bytes'
import { claimName } from './naming'

/** One picture, as every writer needs it. */
export interface Picture {
  /** The `src` exactly as the note wrote it, which is the key a writer swaps. */
  src: string
  /** What to call the file inside a package, unique across the document. */
  name: string
  mime: string
  bytes: Uint8Array
}

const MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}

/** The extension a mime type is normally written with, for naming a file whose
 *  own name says nothing - a `data:` URI has none. */
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
  const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(src)?.[1]?.toLowerCase()
  return (extension === undefined ? undefined : MIMES[extension]) ?? fallback
}

export function suffixFor(mime: string): string {
  return SUFFIXES[mime] ?? 'png'
}

/** A media type this may write into a file, or null.
 *
 *  Two of them arrive from outside: the `Content-Type` a server sends back, and
 *  whatever a `data:` URI in the note says. Both end up in an ePub's manifest
 *  and in a `data:` URI inside an exported page, neither of which escapes what
 *  it interpolates, so a type with a quote or an ampersand in it would break the
 *  book or the page open. A media type is a token and a slash, and nothing here
 *  wants one that is not. */
const MEDIA_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/

function declaredMime(value: string | null | undefined): string | null {
  const type = value?.split(';')[0]?.trim() ?? ''
  return type.startsWith('image/') && MEDIA_TYPE.test(type) ? type : null
}

/** The names Windows keeps for its own devices, extension and all: `NUL.png` is
 *  the null device and a picture written to it goes nowhere, silently. */
const RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i

/** The file name part of a path or URL, without the query a URL may carry.
 *
 *  Decoded before the separators are counted, not after: `a%2F..%2Fb.png` names
 *  one file, and reading it as `a/../b.png` would let a note choose where a
 *  picture lands inside a package - or, on a desktop, beside the note on disk. */
function baseName(src: string): string {
  const path = src.split(/[?#]/)[0] ?? src

  const decoded = (() => {
    try {
      return decodeURIComponent(path)
    } catch {
      // Not valid encoding, so it is already the name it stands for.
      return path
    }
  })()

  // A colon would name an NTFS stream, and a name that is only dots names a
  // folder rather than a file; neither is a picture, so neither survives.
  const last = decoded.split(/[\\/:]/).pop() ?? ''
  return /^\.*$/.test(last) ? '' : last
}

/** Bytes off the network. The browser build and the app both go out over
 *  `fetch`; a request that is refused, times out or answers with an error page
 *  reads as no picture. */
async function remoteBytes(src: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const response = await fetch(src).catch(() => null)
  if (!response?.ok) return null

  const buffer = await response.arrayBuffer().catch(() => null)
  if (!buffer) return null

  const mime = declaredMime(response.headers.get('content-type')) ?? mimeOf(src)

  return { mime, bytes: new Uint8Array(buffer) }
}

/** Where a `src` written in the note lives on this machine. */
export type Resolve = (src: string) => string

/** Every picture in `sources`, read. The order of the answer is the order asked
 *  for, minus whatever could not be read.
 *
 *  Both roads are taken at once: a note with ten pictures waits for the slowest
 *  of them rather than for all ten in turn. */
export async function readPictures(
  sources: readonly string[],
  resolve?: Resolve,
): Promise<Picture[]> {
  const read = await Promise.all(
    sources.map(async (src): Promise<Omit<Picture, 'name'> | null> => {
      const inline = parseDataUri(src)
      // The type a note wrote is words from the note, and it is written into an
      // ePub's manifest and into the `data:` URI of an exported page; see
      // `declaredMime`.
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
      const usable = /\.[a-z0-9]+$/i.test(named) && !RESERVED.test(named)
      const wanted = usable ? named : `picture.${suffixFor(one.mime)}`
      return { ...one, name: claimName(wanted, taken) }
    })
}

/** Every `<img src>` in some HTML pointed somewhere else, by a map from the path
 *  the note wrote to whatever it should be now. A `src` the map says nothing
 *  about is left exactly as it was.
 *
 *  Here rather than in each writer because three of them want it: a page inlines
 *  its pictures, an ePub points them at the files in its own package, and a
 *  TextBundle at the folder beside the text. */
export function swapSources(html: string, wanted: ReadonlyMap<string, string>): string {
  if (!wanted.size) return html

  return mapSources(html, (src) => wanted.get(src) ?? null)
}

/** The same HTML with every picture it names carried inside it as a `data:` URI,
 *  so the file needs neither the disk nor the network to show what it says. A
 *  picture that could not be read keeps the path it had, which is what the note
 *  itself shows: a broken picture, honestly. */
export function inlinePictures(html: string, pictures: readonly Picture[]): string {
  return swapSources(
    html,
    new Map(pictures.map((one) => [one.src, `data:${one.mime};base64,${toBase64(one.bytes)}`])),
  )
}

/** Every `<img src>` in some HTML, in the order they appear, each once.
 *
 *  Broader than what the document model names, because a note may pull another
 *  note into itself with `![[...]]` and the pictures in that one are in the page
 *  too. The ones already carried inline are skipped: there is nothing to fetch. */
export function sourcesIn(html: string): string[] {
  return sourcesOf(html, (src) => !src.startsWith('data:'))
}
