/** Clipping, and saving what was clipped.
 *
 *  Both live in the service worker so that the popup, the page's own menu and a
 *  keyboard shortcut all take the same path: the popup previews what the menu
 *  would have saved, and a clip is a clip however it was asked for.
 *
 *  Nothing here throws. Every way this can fail ends as one sentence from
 *  `problems.ts`, or as the sync service's own words, which the dictionaries
 *  translate like any other string. */

import { api, ApiError, outOfSpace, pathTaken } from '../lib/api'
import { uploaded } from '../lib/images'
import type { Kind } from '../lib/kinds'
import { type Clip, type Clipped, readClip, type Reading, type Saved } from '../lib/messages'
import { fileName, fits, noteFor } from '../lib/note'
import { inFolder, numbered } from '../lib/paths'
import { fill } from '../lib/placeholders'
import { PROBLEMS } from '../lib/problems'
import { remember, settings } from '../lib/settings'

/** How far the numbering will walk before it gives up. Each step is a round
 *  trip, and a title that is taken fifty times over is somebody clipping the
 *  same article all afternoon; the fifty-first is told what is in the way. */
const MOST_NAMES = 50

/** Whatever went wrong, as the sentence to show for it. The service's own
 *  refusals are already sentences and are handed on to be translated; only the
 *  two that deserve fuller words are replaced. */
function reason(error: unknown): string {
  if (outOfSpace(error)) return PROBLEMS.full
  if (!(error instanceof ApiError)) return PROBLEMS.unreachable

  if (error.status === 413) return PROBLEMS.tooLarge
  return error.status === 0 ? PROBLEMS.unreachable : error.message
}

/** The page, read by the half of the extension that can see it. The reader is
 *  injected first: it is not there until somebody clips, and injecting it twice
 *  is harmless. */
async function read(tabId: number, wanted: Reading) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
  return readClip(await chrome.tabs.sendMessage(tabId, wanted))
}

/** What the popup previews and what Save sends back. The pictures are still at
 *  their own addresses here: their bytes are not needed to show the markdown,
 *  and uploading on every look would fill an account with clips nobody kept. */
export async function clip(kind: Kind, tabId: number, link: string | null): Promise<Clipped> {
  let found
  try {
    found = await read(tabId, { read: kind, link })
  } catch {
    // A page no extension may touch: chrome://, the Web Store, the PDF viewer.
    return { problem: PROBLEMS.blocked }
  }

  if (!found) return { problem: PROBLEMS.blocked }
  if (kind !== 'link' && !found.markdown) return { problem: PROBLEMS.empty }

  return { clip: found }
}

/** The clip as a note in a space, with its pictures moved onto the account
 *  first so the note stops depending on the site. */
export async function save(clip: Clip, spaceId: string, folder: string): Promise<Saved> {
  const { token } = await settings()
  if (!token) return { problem: PROBLEMS.signIn }
  if (!spaceId) return { problem: PROBLEMS.noSpaces }

  let urls: string[]
  try {
    urls = await uploaded(token, clip.images, clip.origin.url)
  } catch (error) {
    return { problem: reason(error) }
  }

  const content = noteFor(clip.origin, fill(clip.markdown, urls), new Date(clip.clipped))
  if (!fits(content)) return { problem: PROBLEMS.tooLarge }

  const wanted = inFolder(folder, fileName(clip.origin.title))
  let refusal: unknown = null

  for (let counter = 1; counter <= MOST_NAMES; counter++) {
    try {
      const note = await api.createNote(token, spaceId, numbered(wanted, counter), content)
      await remember({ target: { spaceId, folder } })
      return { path: note.path }
    } catch (error) {
      refusal = error
      if (!pathTaken(error)) break
    }
  }

  return { problem: reason(refusal) }
}
