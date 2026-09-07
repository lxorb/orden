/** The pictures, moved off the site and onto the account.
 *
 *  A clipped note that still points at the article's own image server stops
 *  working the day the article moves, and shows nothing at all behind a login.
 *  So every picture is fetched, hashed, and uploaded as a blob, and the note
 *  points at `/i/<hash>.<ext>` the way a picture pasted into the app does; see
 *  `apps/desktop/src/lib/assets.ts`.
 *
 *  Nothing here is allowed to lose a clip. A picture that cannot be fetched,
 *  or that the API will not store, keeps the address it had: the note is a
 *  little more fragile and it is still a note. The one exception is an account
 *  with no room left, which is about the account rather than the picture, and
 *  which the person has to be told about. */

import { api, BASE, outOfSpace } from './api'

/** What the blob route stores; see `services/sync/src/blobs.ts`. An SVG or a
 *  BMP is refused there, so it is not offered here. */
const STORABLE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

/** The blob route's own ceiling for a picture. */
const LARGEST = 16 * 1024 * 1024

/** Long enough for a slow image server, short enough that one of them cannot
 *  hold a clip open past the moment it stops feeling instant. */
const PATIENCE = 8000

/** How many pictures one clip moves. An article has a handful; a page the
 *  extractor could not read and whose whole body was taken instead can have
 *  hundreds, and those are decoration rather than content. */
const MOST = 60

function hex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The type a response declares, with any parameters after it left off. */
function typeOf(header: string | null): string {
  return (header?.split(';')[0] ?? '').trim().toLowerCase()
}

/** Where a stored picture lives. The extension after the hash is cosmetic - the
 *  route reads only the hash - and it is what keeps a sensible file name when
 *  somebody saves the image out of a note. */
function blobUrl(hash: string, type: string): string {
  return `${BASE}/i/${hash}.${STORABLE[type] ?? 'png'}`
}

/** One picture on the account, or null to leave it where it is. */
async function move(token: string, url: string): Promise<string | null> {
  // Already ours: a clip of a page that itself shows a Nib blob.
  if (url.startsWith(`${BASE}/i/`)) return null

  // Cookies go along because the picture is one the person is looking at, and
  // some of them are only served to a reader who is signed in to the site.
  const response = await fetch(url, {
    credentials: 'include',
    signal: AbortSignal.timeout(PATIENCE),
  })
  if (!response.ok) return null

  const type = typeOf(response.headers.get('content-type'))
  if (!(type in STORABLE)) return null

  const bytes = await response.arrayBuffer()
  if (!bytes.byteLength || bytes.byteLength > LARGEST) return null

  const hash = hex(await crypto.subtle.digest('SHA-256', bytes))
  await api.putBlob(token, hash, type, bytes)

  return blobUrl(hash, type)
}

/** Every picture's address in the note that is about to be written, in the
 *  order it was asked about. */
export async function uploaded(token: string, urls: string[]): Promise<string[]> {
  const moved = await Promise.all(
    urls.slice(0, MOST).map(async (url) => {
      try {
        return (await move(token, url)) ?? url
      } catch (error) {
        // An account with no room left is the person's problem to hear about,
        // not something to paper over with a link back to the site.
        if (outOfSpace(error)) throw error
        return url
      }
    }),
  )

  return [...moved, ...urls.slice(MOST)]
}
