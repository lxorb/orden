/** Rewriting the links to a note that has just been renamed or moved.
 *
 *  Renaming a note in Obsidian rewrites every link to it, silently, and so does
 *  this: a link that stops working because a file was renamed is a broken note,
 *  and nobody renames a note in order to break their own links.
 *
 *  Each link keeps the spelling it was written in. A bare `[[Note]]` becomes
 *  `[[Renamed]]`, or `[[folder/Renamed]]` where the name alone would reach another
 *  note of that name; a path-qualified `[[folder/Note]]` becomes `[[other/Renamed]]`;
 *  one written with its extension keeps it; and `[label](../folder/Note.md)` keeps
 *  its label and gets a path relative to the note it sits in. Everything that is
 *  not a link comes back character for character, which is what makes this safe
 *  to run over every note in a space.
 *
 *  Pure on purpose: which links point at the note is decided by the caller, since
 *  answering that needs the whole space, and none of this needs to know about
 *  one. */

import { findLinks, type FoundLink } from '@nib/markdown/links'
import { shownName } from './note-name'
import { folderOf, relativePath } from './space-paths'

/** Where a link points now, and, for a link that names the place by its name,
 *  whether a spelling reaches it: `written` resolved from the note the link is in,
 *  in the space as it is once the move is done. Without one, the shortest spelling
 *  is taken on trust. */
export interface Placed {
  path: string
  reaches: (written: string) => boolean
}

export interface Move {
  /** Where the note was and where it is now, relative to the space. */
  from: string
  to: string
}

/** The text with every link the caller claims points at `move.from` pointing at
 *  `move.to` instead, or null when the note holds no such link - which is the
 *  answer for almost every note in a space, and the reason nothing is written. */
export function rewriteLinks(
  text: string,
  /** The note being rewritten, relative to the space. */
  source: string,
  move: Move,
  points: (link: FoundLink) => boolean,
): string | null {
  return retargetLinks(text, source, (link) => (points(link) ? move.to : null))
}

/** The same with a place of its own for each link: `to` answers where the thing a
 *  link names is now, relative to the space, or null for a link to leave as it is.
 *  What a folder that moved needs, since every note in it went somewhere else, and
 *  a note that moved, whose own relative links now start from another folder. */
export function retargetLinks(
  text: string,
  /** The note being rewritten, relative to the space, where it is now. */
  source: string,
  to: (link: FoundLink) => string | Placed | null,
): string | null {
  let out = ''
  let at = 0
  let any = false

  for (const link of findLinks(text)) {
    const there = to(link)
    if (there === null) continue
    any = true
    out += text.slice(at, link.targetFrom)
    out += targetFor(link, source, there)
    at = link.targetTo
  }

  return any ? out + text.slice(at) : null
}

/** What to write where the old target was. Only the target is replaced, so a
 *  `#heading`, an alias and a title all stay exactly as they were. */
function targetFor(link: FoundLink, source: string, placed: string | Placed): string {
  const to = typeof placed === 'string' ? placed : placed.path
  if (link.kind === 'markdown') {
    // Written from the top of the space, it stays so.
    if (link.target.startsWith('/')) return encodeTarget(`/${to}`)
    return encodeTarget(relativePath(folderOf(source), to))
  }

  // A link written without the file's ending stays without one, whichever kind of
  // file it names: `[[Docs]]` to a website renamed `Handbook.url` is `[[Handbook]]`,
  // the way a note's is. `shownName` is the one reading of which endings a name
  // may leave off; a PDF's is not one of them, so a link to one keeps its ending.
  const spelled = (path: string) =>
    shownName(link.target) === link.target ? shownName(path) : path
  const fromTop = spelled(`/${to}`)
  const reaches = (written: string) => typeof placed === 'string' || placed.reaches(written)

  // A path from the top of the space stays one, and reaches what it names.
  if (link.target.startsWith('/')) return fromTop

  // A path written out stays the whole path. A bare name stays bare where the name
  // alone still reaches the note. Where the space holds another of that name nearer
  // to the link, or shallower, it takes as much of the path as reaches the one that
  // moved, the way Obsidian writes a link to a name two notes share: `[[Plan]]` to
  // `A/Plan.md` renamed `A/Road.md` beside a `B/Road.md` is `[[A/Road]]` from `B`,
  // and opened `B/Road.md` written `[[Road]]`. Where nothing does - a note at the
  // top of the space has no path to tell it from a namesake beside the link, and a
  // path is read as the end of one - it is the path from the top, `[[/Road]]`
  // (B543).
  const parts = to.split('/')
  const first = link.target.includes('/') ? 0 : parts.length - 1
  for (let from = first; from >= 0; from--) {
    const written = spelled(parts.slice(from).join('/'))
    if (reaches(written)) return written
  }
  return fromTop
}

/** A path as a markdown target: the characters a browser or an editor would
 *  otherwise read as something else. `#` opens a fragment and a space ends the
 *  target, and a `)` (`1) Intro.pdf`) ends the link, so those are written out.
 *
 *  Exported because the markdown export writes targets too: a `[[wikilink]]`
 *  that becomes a real link has to be spelled the same way a renamed one is. */
export function encodeTarget(path: string): string {
  return encodeURI(path).replace(/[#?()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}
