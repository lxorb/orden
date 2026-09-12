/** Which space and which note a verb is about.
 *
 *  Every verb that names a file goes through here, so the two questions that can
 *  go wrong - is that a space, and is that a path inside it - are asked in one
 *  place for both roads in. See inside.ts, which is the half that judges the path
 *  without knowing anything about spaces. */

import { insideSpace, withinSpace } from '../space-paths'
import type { Space } from '../workspace.svelte'
import { workspace } from '../workspace.svelte'
import { said, type Said } from './args'
import { insideOnly } from './inside'

/** A note a verb is working on: how the space speaks of it, where it is on this
 *  disk, and what it says. */
export interface Note {
  /** Relative to the space, `/` separators, which is how a link names it. */
  relative: string
  path: string
  text: string
}

/** The space a verb is about: the one it named, by name or by id, or the one that
 *  is open.
 *
 *  Naming one switches to it, because the verbs work on what is open. A link that
 *  wrote a note into a space the app was not showing would be a link whose result
 *  nobody can see, and showing the result is the whole of how an automated write
 *  stays honest. */
export async function spaceFor(args: Said): Promise<Space> {
  const wanted = said(args, 'space')
  if (!wanted) {
    const open = workspace.activeSpace
    if (!open) throw new Error('there is no space open')

    return open
  }

  const folded = wanted.toLowerCase()
  const found = workspace.spaces.find(
    (one) => one.id === wanted || one.name.toLowerCase() === folded,
  )
  if (!found) throw new Error(`there is no space called ${wanted}`)

  if (found.id !== workspace.activeSpaceId) await workspace.showSpace(found.id)

  return found
}

/** A path the caller named, as the space speaks of it. Throws for a path that is
 *  not inside the space, which is the one thing a caller may not ask for. */
export function relativeIn(args: Said, name = 'path'): string {
  const asked = said(args, name)
  if (!asked) throw new Error(`say which ${name}`)

  return insidePath(asked)
}

/** One path, judged. Whatever a verb worked out that a path might be, this is what
 *  makes it one: `openNote` asks the file index what a bare note name is and hands
 *  the answer here, so a name and a path come to the same judge rather than the
 *  index's answer being trusted for being the index's. Resolve first, then judge -
 *  nothing between this and `insideSpace`. */
export function insidePath(asked: string): string {
  const safe = insideOnly(asked)
  if (safe === null) throw new Error(`${asked} is not a path inside the space`)

  return safe
}

/** The note a verb is about: the one it named, or the one on screen when it named
 *  none and the space holds that one. Reading what is open is what makes `nib
 *  words` and `nib outline` answer about the thing in front of the reader.
 *
 *  Throws when the note is not there, because every caller of this is about to
 *  read or count its words and there is nothing honest to answer with. */
export async function noteFor(args: Said, name = 'path'): Promise<Note> {
  const space = await spaceFor(args)

  if (said(args, name) === null) {
    const open = workspace.active
    const path = open?.path
    if (!open || !path) throw new Error('no note is open, so say which path')

    // And it has to be this space's note. A note is opened from anywhere - a file
    // the shell handed over, something in a downloads folder - and a caller that
    // names no path is otherwise handed whatever that is: read by `notes.read`,
    // and written by `properties.set`, which is the only verb here that changes a
    // note it did not have to name. The reach of a link is the space or nothing.
    //
    // Refused without the path in the sentence, for the same reason the answer
    // carries `relative` rather than `path`: where a file outside the space sits
    // on this disk is this machine's own layout, and the caller is whoever wrote
    // the link.
    const relative = withinSpace(space.root, path)
    if (relative === null) throw new Error('no note of this space is open, so say which path')

    workspace.flush()
    return { relative, path, text: open.doc }
  }

  const relative = relativeIn(args, name)
  const path = insideSpace(space.root, relative)
  const text = await workspace.noteText(path)
  if (text === null) throw new Error(`there is no note at ${relative}`)

  return { relative, path, text }
}
