/** The space and the note an account starts with.
 *
 *  An account that owns nothing is an empty rail in the app, a connector that
 *  can only answer "no spaces yet" and a clipper with nowhere to put a page. So
 *  the account comes into being holding one space with one note in it, written
 *  here as it is made rather than by whichever client happens to arrive first:
 *  the desktop app, the browser, a phone, the glasses plugin, the extension and
 *  an LLM then all open the same space and read the same note.
 *
 *  The space's name and the note's path are English on every account, on
 *  purpose. The browser build seeds a local note at `/Notes/Read me.md` before
 *  anybody has signed in, and the two are one note only while they are at one
 *  path; a translated folder would sit beside the local one instead of pairing
 *  with it. The path is an identity, the prose is what a person reads. */

import { addNote } from '../notes'
import type { Env } from '../types'
import { addSpace } from './space'
import { welcomeNote } from './welcome'

const SPACE = 'Notes'
const NOTE = 'Read me.md'
/** Lucide's notebook, the app's own first answer for `notes`; see
 *  apps/desktop/src/lib/icons.ts. It is set so that the rail has a mark to draw
 *  on every device rather than a bare letter. */
const ICON = 'NotebookPen'

/** Gives an account its first space and the note in it, and nothing at all to
 *  an account that already holds a space. Called as an account is made, and
 *  guarded here rather than by the caller so that a retried sign-in, or two
 *  arriving together, cannot leave somebody with two of them. */
export async function makeFirstSpace(
  env: Env,
  userId: string,
  accepted: string | undefined,
): Promise<void> {
  const held = await env.DB.prepare('select id from spaces where user_id = ? and deleted = 0')
    .bind(userId)
    .first<{ id: string }>()

  if (held) return

  const space = await addSpace(env, userId, SPACE, ICON)
  await addNote(env, space.id, NOTE, welcomeNote(accepted))
}
