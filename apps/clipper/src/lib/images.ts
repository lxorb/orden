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

/** Whether a picture belongs to the page being clipped, which is the only case
 *  in which the person's cookies for it are any of our business.
 *
 *  The host itself or a name under it: an article's pictures live on
 *  `images.site.example` as often as on the site itself, and a signed-in reader
 *  has one session across both. Anything further away is a third party, which
 *  could not have used the site's cookies anyway. */
export function belongsTo(picture: string, page: string): boolean {
  try {
    const from = new URL(picture).hostname
    const here = new URL(page).hostname

    return !!here && (from === here || from.endsWith(`.${here}`) || here.endsWith(`.${from}`))
  } catch {
    return false
  }
}

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
async function move(token: string, url: string, page: string): Promise<string | null> {
  // Already ours: a clip of a page that itself shows a Nib blob.
  if (url.startsWith(`${BASE}/i/`)) return null

  // A picture the page carried inside itself, as a `data:` URL. There is no
  // site to stop depending on and nothing worth a request, so it stays as it is.
  if (!/^https?:\/\//i.test(url)) return null

  // Cookies go along for the site's own pictures, some of which are served only
  // to a reader who is signed in. They do not go anywhere else: the extension
  // holds every host, so a fetch from here carries cookies a page could not
  // have got sent itself, and the addresses come from markup the page wrote.
  const response = await fetch(url, {
    credentials: belongsTo(url, page) ? 'include' : 'omit',
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
 *  order it was asked about. `page` is where the clip came from, which is what
 *  says whether a picture is the site's own. */
export async function uploaded(token: string, urls: string[], page: string): Promise<string[]> {
  const moved = await Promise.all(
    urls.slice(0, MOST).map(async (url) => {
      try {
        return (await move(token, url, page)) ?? url
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
