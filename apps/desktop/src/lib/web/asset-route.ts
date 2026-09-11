/** The address a picture has in the browser build.
 *
 *  A webview on a desktop is handed a URL for a file on disk. In a browser there
 *  is no disk and no file, only a row in the asset store - and a note-relative
 *  `pictures/x.png` in an `<img>` is asked of the page's own origin, where nothing
 *  answers. So the store is given an address of its own, `/asset/<space>/<path>`,
 *  and public/sw.js answers it out of IndexedDB.
 *
 *  Why a route and not a `blob:` URL. A row has to be read before a blob exists,
 *  and reading it is asynchronous, while every surface that draws a picture
 *  resolves synchronously: the editor's widget inside a CodeMirror facet, the
 *  reading view inside a string replace over finished HTML, the canvas inside a
 *  template. None of them can wait, so every one of them would have had to change
 *  shape - and the URLs would still have died with the page, taking a reload and
 *  every export with them. An address is one line, survives a reload, is what a
 *  `<img>` the renderer emitted as plain markup already asks for, and leaves the
 *  path the note wrote exactly as the note wrote it, which is what keeps the
 *  folder openable in Obsidian.
 *
 *  `/asset/` and not `/assets/`: the build's own chunks land in `/assets/`, and a
 *  worker answering those would be answering for the app itself.
 *
 *  public/sw.js is the other half of this and cannot import it - a service worker
 *  is a page of its own, fetched before the app exists, and a classic script so
 *  that every browser that has workers at all can run it. It therefore spells the
 *  prefix, the database and the types out a second time, and asset-route.test.ts
 *  reads the file and holds the two to each other. */

import { normalise } from './paths'

/** Everything under here is the asset store's, and nothing else is. */
export const ASSET_ROUTE = '/asset/'

/** What a file's name says it holds. Correctness matters in one direction and not
 *  the other: a browser will draw a JPEG called `image/jpg`, and will draw
 *  nothing at all for an SVG that is not `image/svg+xml`. */
const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

/** What is answered for a name that says nothing: bytes, and no claim about them. */
export const UNKNOWN_TYPE = 'application/octet-stream'

export function mimeOfPath(path: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()
  return (extension && TYPES[extension]) || UNKNOWN_TYPE
}

/** The type to hand out for a stored file: what its name says, falling back to
 *  what was written down beside it when the name says nothing. Rows written
 *  before this existed carry `image/jpg` and `image/svg`, which is why the name
 *  is asked first rather than second. */
export function assetType(path: string, stored?: string): string {
  const known = mimeOfPath(path)
  return known === UNKNOWN_TYPE && stored ? stored : known
}

/** A store path as the address the service worker answers.
 *
 *  Encoded a segment at a time, so a folder with a space, a `#` or a `%` in its
 *  name survives the round trip and the slashes stay slashes. */
export function assetRoute(path: string): string {
  const inside = normalise(path).slice(1)
  return ASSET_ROUTE + inside.split('/').map(encodeURIComponent).join('/')
}

/** The store path an address of ours stands for, or null for an address that is
 *  not one of ours. Either the path on its own, as it is written into a page, or
 *  the whole URL, as a document that has been through the renderer carries it. */
export function assetStorePath(url: string): string | null {
  const at = url.indexOf(ASSET_ROUTE)
  // Nothing that merely has the words in it: the prefix is either the start of
  // the address or everything after a scheme and a host.
  if (at !== 0 && !(at > 0 && /^[a-z][a-z\d+.-]*:\/\/[^/]*$/i.test(url.slice(0, at)))) return null

  const written = url.slice(at + ASSET_ROUTE.length).split(/[?#]/)[0] ?? ''
  if (!written) return null

  try {
    return normalise(written.split('/').map(decodeURIComponent).join('/'))
  } catch {
    // Not valid encoding, so it names no row and never did.
    return null
  }
}
