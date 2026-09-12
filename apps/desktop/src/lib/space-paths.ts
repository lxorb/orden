/** Turning the app's paths into the ones a link speaks in, and back.
 *
 *  A note's path on disk is whatever the platform writes: a drive letter and
 *  backslashes on Windows, a slash-separated path elsewhere. A link says
 *  `folder/Note`. One file for the two conversions, because publishing, the link
 *  index and the composer all need them. */

import { insideOnly } from './automation/inside'
import { joinPath } from './tauri'

/** A path inside a space as the space speaks of it: relative to the root, and
 *  with `/` separators whichever the platform writes. */
export function relativeTo(root: string, path: string): string {
  if (!root || !path.startsWith(root)) return path.replace(/\\/g, '/')
  return path
    .slice(root.length)
    .replace(/^[\\/]+/, '')
    .replace(/\\/g, '/')
}

/** The same, for a path that may not be inside the space at all: null when this
 *  root does not hold it.
 *
 *  `relativeTo` hands a path it does not recognise straight back, because it is
 *  asked about paths already known to be inside a space - every row of the file
 *  list. This is the one to ask about a path that arrived from somewhere else: the
 *  note somebody opened out of a downloads folder, a path read back out of
 *  storage. The root has to hold it, and what is left over has to be something the
 *  space would take, which is `insideOnly` - the same judge a `nib://` link's path
 *  goes through - so a path that climbs back out from under the root is refused
 *  here as it is there.
 *
 *  Both separators, because which one a path is written with says nothing about
 *  where it points. */
export function withinSpace(root: string, path: string): string | null {
  const folder = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const file = path.replace(/\\/g, '/')
  if (!folder || !file.startsWith(`${folder}/`)) return null

  return insideOnly(file.slice(folder.length + 1))
}

/** The same path back as one the filesystem understands. */
export function insideSpace(root: string, relative: string): string {
  return joinPath(root, relative)
}

/** An absolute path that arrived from outside the app, as a path inside one of
 *  these spaces - or null for one that is inside none of them.
 *
 *  The phone's own road names a note this way round: a widget row is drawn from a
 *  path on disk, so the row hands that path back when it is tapped. The activity
 *  carrying it is exported, which means any app on the phone can send one, so
 *  what arrives is a path only once it is under a root this app knows and the
 *  rest of it has been through `insideOnly` - the same judgement a `nib://` link
 *  gets, in the same place, rather than a second rule that could differ from it.
 *
 *  What comes back is rebuilt from the root rather than handed on as it arrived,
 *  so nothing the caller wrote survives the trip.
 *
 *  Given the roots rather than reading them: which folders are spaces belongs to
 *  the workspace, and what a path may be belongs here. */
export function insideAnyOf(roots: readonly string[], said: string): string | null {
  const folded = said.replace(/\\/g, '/').trim()

  for (const root of roots) {
    if (!root) continue

    // The separator is part of the prefix, so a space at `/notes` does not claim
    // a path in `/notes-elsewhere`.
    const head = root.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!folded.startsWith(`${head}/`)) continue

    // The separators between the root and the rest are separators, however many
    // of them were written: what is left has to reach `insideOnly` as a relative
    // path or it would be refused for being absolute.
    const safe = insideOnly(folded.slice(head.length).replace(/^\/+/, ''))
    if (safe) return insideSpace(root, safe)
  }

  return null
}

/** The folder a path sits in, or the empty string for one at the top. */
export function folderOf(relative: string): string {
  const at = relative.lastIndexOf('/')
  return at === -1 ? '' : relative.slice(0, at)
}

/** The last part of a path. */
export function nameOf(relative: string): string {
  return relative.split('/').pop() ?? relative
}

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

/** The name a link uses for a note: its file name without the extension. */
export function noteName(relative: string): string {
  return nameOf(relative).replace(MARKDOWN, '')
}

export function withoutExtension(relative: string): string {
  return relative.replace(MARKDOWN, '')
}

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN.test(path)
}

/** How to get from one folder to a file, as a markdown link would write it. A
 *  file in the same folder is named on its own rather than as `./name`, which is
 *  what a person writing the link by hand would do. */
export function relativePath(fromFolder: string, to: string): string {
  const here = fromFolder ? fromFolder.split('/') : []
  const there = to.split('/')

  let shared = 0
  while (shared < here.length && shared < there.length - 1 && here[shared] === there[shared]) {
    shared++
  }

  const up = Array.from({ length: here.length - shared }, () => '..')
  return [...up, ...there.slice(shared)].join('/')
}
