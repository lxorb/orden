/** One space, moved between this machine and the account.
 *
 *  A pass over a space is two halves: take what the server has, then offer
 *  what we have. Neither knows anything about the loop that calls them - how
 *  often, when to give up, what the light says - which is the store next door.
 *
 *  What makes it work without diffing whole documents is the hash of each note
 *  as it stood after the last pass. A local hash that no longer matches means
 *  the file changed here; a version that has moved means it changed there; and
 *  both at once is the only case that needs a decision. That decision is
 *  always the same one: never silently drop an edit.
 *
 *  For a note that is a conflict copy: the other side's copy lands beside ours
 *  with a name that says where it came from, because two people typing in one
 *  paragraph is not something a machine can settle. For a canvas it is a merge,
 *  because a canvas can be settled: everything on it has an id and a time, so
 *  the union of the two keeps every card and every stroke either device drew
 *  and nobody has to go looking for a second file. See canvas-merge.ts. A web note
 *  is settled too, the newer copy standing: it is a tab written down, and a copy of
 *  a bookmark is clutter rather than safety. See web-tab/settle.ts. */

import { isCanvasTarget, isPagesTarget, isPdfTarget, isWebTarget } from '@nib/markdown/links'
import { conflictPath } from '@nib/markdown/paths'
import { inForeignCopy } from '@nib/sync-core/foreign'
import { api, ApiError, type RemoteNote, type SpaceFile } from '../api'
import { sha256 } from '../bytes'
import { log } from '../log'
import { without } from '../records'
import { isNumber, isRecord, isString } from '../stored'
import { folderOf, nameOf, relativeTo } from '../space-paths'
import { syncMark } from '../surfaces.svelte'
import { invoke, joinPath } from '../tauri'
import { settleShortcuts } from '../web-tab/settle'
import { isUntouchedWelcome } from '../welcome'
import { baseOf, behind, unixLines } from './ancestry'
import { type Clash, type ConflictRule, DEFAULT_RULE } from './conflicts'
import {
  fileStamp,
  type Mirror,
  type Moving,
  type Tracked,
  type TrackedFile,
  within,
} from './mirror'
import { type Folded, foldWebCopies } from './web-copies'
import { writeDown } from './write-down'
import type { Entry } from '../workspace.svelte'

/** A page of changes with the notes somebody is waiting on at the front.
 *
 *  Partitioned rather than sorted, so everything keeps the order the account sent
 *  it in and only the wanted few move. Which end of a page a note is fetched from
 *  makes no difference to what is written: each note is settled against the file
 *  beside it and nothing else, and the cursor moves only once the page is through.
 *  See `pull`. */
function ordered<T extends { path: string }>(
  notes: readonly T[],
  wanted: ReadonlySet<string> | undefined,
): readonly T[] {
  if (!wanted?.size) return notes

  const first = notes.filter((one) => wanted.has(one.path))
  if (!first.length) return notes

  return [...first, ...notes.filter((one) => !wanted.has(one.path))]
}

/** Whether a path the account named can be joined onto a space's folder.
 *
 *  The listing arrives over the network, and in a shared space the names in it
 *  were written by somebody else: a path that climbs out with `..`, or names a
 *  disk of its own, would have the pass write a file anywhere on this machine
 *  the person can write. Nothing below the folder can say that, so a name that
 *  does is not a note to place at all. Both separators, because which one a
 *  path uses says nothing about where it points. */
function placeable(path: string): boolean {
  if (!path || /^[a-zA-Z]:/.test(path) || /^[\\/]/.test(path)) return false

  return path.split(/[\\/]/).every((part) => part !== '' && part !== '.' && part !== '..')
}

/** Whether a file on this disk is the same words the account's hash names.
 *
 *  Byte for byte, or the same text written with the other line ending. A file that
 *  was already on this machine with Windows line endings keeps them whenever the
 *  app writes it - see `as_written` in src-tauri/src/notes.rs, which is there so
 *  that correcting one word does not rewrite every line of the file - so its bytes
 *  never hash to what the account holds however exactly the two agree. Reading that
 *  as "somebody wrote here" would put a conflict copy beside every note in such a
 *  folder, on every pass.
 *
 *  The second digest is only ever worked out for a file that has a carriage return
 *  in it, so the ordinary case costs exactly one. */
async function holdsSameWords(local: string, hash: string): Promise<boolean> {
  if (!hash) return false
  if ((await sha256(local)) === hash) return true
  if (!local.includes('\r')) return false

  return (await sha256(unixLines(local))) === hash
}

/** Two copies of a file that settle into one without a copy beside it, or null for
 *  a note, whose two copies are somebody's words.
 *
 *  A canvas and a page note merge: everything on them has an id and a time, so the
 *  union keeps every card and stroke either device drew. A web note settles to the
 *  newer copy with the fields only the older one said; see web-tab/settle.ts. The merge
 *  is fetched with the first plane that needs it. `theirsNewer` is asked only for a web
 *  note, the one that cares which side was last. */
async function settled(
  path: string,
  ours: string,
  theirs: string,
  theirsNewer: () => Promise<boolean>,
): Promise<string | null> {
  if (isCanvasTarget(path) || isPagesTarget(path)) {
    return (await import('@nib/markdown/canvas-merge')).mergeCanvasFiles(ours, theirs)
  }

  if (isWebTarget(path)) return settleShortcuts(path, ours, theirs, await theirsNewer())

  return null
}

/** Whether the copy the account holds was written after the file here.
 *
 *  The file's own stamp, which is what the watcher already reads. A platform that
 *  keeps none - the browser, where a note is a row rather than a file - answers
 *  that theirs is newer: the copy that travelled is the one more likely to have
 *  been written last, and the other is in this device's history either way. */
async function theirsIsNewer(path: string, updatedAt: number): Promise<boolean> {
  const stamp = await fileStamp(path)
  return stamp === null || updatedAt > stamp.modified
}

function flatten(entry: Entry): Entry[] {
  const out: Entry[] = []
  const walk = (node: Entry) => {
    for (const child of node.children) {
      if (child.is_dir) walk(child)
      else out.push(child)
    }
  }
  walk(entry)
  return out
}

/** Whether a note is in a room, by its id on the account.
 *
 *  A note in a room has one truth and it is the room's: every device in it holds
 *  the same characters, and the room writes them into the account itself. So a
 *  pass neither pushes such a note - there is nothing here the room has not
 *  already carried - nor treats a version it has not seen as a disagreement. The
 *  copy that comes down is simply written, and no conflict copy is ever made for
 *  it, because two devices typing in one paragraph is exactly what the room has
 *  already settled.
 *
 *  A question rather than a list, and asked again at every note and after every
 *  refusal. A pass is seconds of round trips and a room settles the moment somebody
 *  stops typing, so a list taken at the top of a pass is a list from before both:
 *  the note whose room settled halfway through went up as a file naming a version
 *  the account had just moved past, the 409 that came back was read as a second
 *  writer, and the machine that had been typing in that one note the whole time was
 *  left with a second copy of it. A set answers this shape too, which is what a test
 *  hands in when there are no rooms at all.
 *
 *  Handed in rather than imported so this file stays about moving files: the store
 *  next door is what knows about rooms. */
export interface Joined {
  has(id: string): boolean
}

/** Whoever is waiting on a pass, and what they need out of it while it runs.
 *
 *  Handed in for the same reason `joined` is: this file stays about moving files,
 *  and the store next door is what knows who is waiting. See sync.svelte.ts and
 *  arriving.svelte.ts.
 *
 *  None of it changes what the pass does to a file. The names go out earlier and
 *  the bodies come down in a different order; every write, every comparison and
 *  every conflict copy is the one it always was. */
export interface Waiting {
  /** Every note a page of changes named, by the path it will have here, said
   *  before a single body has been asked for. This is what lets the file list be
   *  right within a second of signing in. */
  listed?: (paths: string[]) => void
  /** One note written, by the path it landed at. */
  wrote?: (path: string) => void
  /** The record written down now, in the middle of a pass: before and after each
   *  rename of a round of moves, so a quit at any point can be finished from. */
  save?: () => void
  /** One note moved here because another device renamed or moved it, by the paths
   *  it had and has. */
  moved?: (from: string, to: string) => void | Promise<void>
  /** Notes to fetch first, by their path in the space: the one somebody is looking
   *  at, and the one they were looking at last. A page is a few hundred notes and
   *  a slow connection is a body a second, so which end of it the open note is at
   *  is the difference between reading it now and reading it in five minutes. */
  wanted?: ReadonlySet<string>
  /** What to do when the same note was written in two places. Handed in rather
   *  than read here, so the pass has no opinion about where a setting lives; see
   *  sync/conflicts.ts. */
  rule?: ConflictRule
  /** One note the two copies disagree about, for the rule that leaves it alone
   *  and says so. */
  clashed?: (clash: Clash) => void
  /** Notes not to send, because a clash about them is still waiting for an
   *  answer: pushing one is exactly what would write over the copy nobody has
   *  looked at yet. */
  held?: ReadonlySet<string>
  /** The same notes by id; see `toldAgain`. */
  asked?: ReadonlySet<string>
  /** Whether a file, by the path it has here, is one this space keeps whatever
   *  another device says: the archive, whose promise is that nothing in it is ever
   *  deleted. Handed in for the reason the rest is; see workspace/archive. */
  kept?: (path: string) => boolean
}

/** Takes what the account has moved on to. Answers whether anything did. */
export async function pull(
  mirror: Mirror,
  token: string,
  joined: Joined,
  waiting?: Waiting,
): Promise<boolean> {
  // Read once: a rename lands in `renamed` while a pass is in the air, and a
  // pass that changed folder halfway would join the new root onto paths it
  // listed under the old one.
  const root = mirror.root
  let moved = false
  await journalled(mirror)
  if (await toldAgain(mirror, token, waiting?.asked, waiting?.clashed)) moved = true

  for (;;) {
    const page = await api.changes(token, mirror.spaceId, mirror.cursor)
    if (page.notes.length) moved = true

    // The names, at once. One page of changes is the whole listing of a space the
    // account has and this machine has not, and it arrives a request in: the file
    // list can be drawn from it while the bodies below take as long as they take.
    waiting?.listed?.(
      page.notes
        .filter((one) => !one.deleted && placeable(one.path) && !inForeignCopy(one.path))
        .map((one) => joinPath(root, one.path)),
    )

    const notes = ordered(page.notes, waiting?.wanted)
    const carried = (one: RemoteNote) => placeable(one.path) && !inForeignCopy(one.path)

    // What the account deleted goes first, so a name it held is free for a note moved
    // onto it in the same page; then every move at once, see `movedThere`. Neither
    // depends on the order the page came in: a delete names its note by id, and the
    // live notes below are each settled against their own file.
    // Where each note this machine knows lives here, by its id.
    const known = new Map(Object.entries(mirror.notes).map(([path, one]) => [one.id, path]))
    const named = new Set(notes.filter((one) => !one.deleted).map((one) => one.path))
    // A note whose rename here the account is still to hear of is left as it is, and
    // the page read again once it has: its entry is at the name the file left. Moved
    // or deleted by that entry, the file at its new name was a second note.
    const untold = (one: RemoteNote) => mirror.untold?.[one.id] !== undefined
    for (const remote of notes) {
      if (!remote.deleted || !carried(remote) || untold(remote)) continue
      const target = joinPath(root, remote.path)
      const here = known.get(remote.id) ?? remote.path
      const kept = waiting?.kept?.(target) === true
      await deletedThere(mirror, remote, here, joined, kept, named, waiting)
    }

    const places = new Map(Object.entries(mirror.notes).map(([path, one]) => [one.id, path]))
    const moves = notes.flatMap((remote) => {
      const was = places.get(remote.id)
      return !remote.deleted &&
        carried(remote) &&
        !untold(remote) &&
        was !== undefined &&
        was !== remote.path
        ? [{ remote, was }]
        : []
    })
    const waits = new Set(moves.length ? await movedThere(mirror, moves, waiting) : [])
    for (const remote of notes) if (untold(remote)) waits.add(remote.id)
    unsettled.set(mirror, waits)
    // A note left aside that this page no longer moves, from a round long past, is put
    // back in sight rather than kept hidden for good.
    for (const [path, one] of Object.entries(mirror.notes)) {
      if (isAside(path) && !waits.has(one.id) && (await present(joinPath(root, path)))) {
        await shownAgain(mirror, path, one.id, named, waiting)
      }
    }

    for (const remote of notes) {
      // A name that would land outside the space is left where it is; see
      // `placeable`.
      if (!placeable(remote.path)) continue

      // Another sync tool's copy is never carried; see `inForeignCopy`. The account
      // letting go of one is forgotten here, and the file, where there is one, stays.
      if (inForeignCopy(remote.path)) {
        if (remote.deleted && mirror.notes[remote.path]?.id === remote.id) {
          mirror.notes = without(mirror.notes, remote.path)
        }
        continue
      }

      const target = joinPath(root, remote.path)

      // Taken above, or still on their way to a new name; see `movedThere`.
      if (remote.deleted || waits.has(remote.id)) continue

      const tracked = mirror.notes[remote.path]
      if (tracked?.version === remote.version) continue

      const local = await invoke<string>('read_note', { path: target }).catch(() => null)

      // A note this machine has an entry for and no longer has a file for is one
      // that went away here - renamed, moved or deleted - rather than one it has
      // never seen. Both are "the account has it and the folder does not", and only
      // the entry tells them apart.
      //
      // Writing it down again undoes what somebody did. A rename is the case that
      // showed it: the file leaves under one name and arrives under another, nothing
      // tells the mirror, and the pass is what reads it off the folder. The pull put
      // the old name back on the disk, so the push below found the file present,
      // skipped its own "a file that vanished locally is a delete" - and the account
      // was left holding both names alive, with every other machine downloading the
      // one nobody has any more. The entry is left exactly as it is, so the push sees
      // the gap and deletes the note the way it always has.
      if (local === null && tracked !== undefined) continue

      // There but unreadable (an encoding, a lock) is not a gap to fill.
      if (local === null && (await fileStamp(target)) !== null) {
        log('warn', `sync: ${target} unreadable, not written over`)
        continue
      }

      // The file and the account already say the same thing, so there is nothing
      // to bring down and nothing to settle: the entry is recorded and the note is
      // done with. This is what mends a mirror that has lost entries - the note is
      // found agreeing rather than judged - and it is the whole of a pass over a
      // space nothing has changed, without a body being fetched for any of it.
      if (local !== null && (await holdsSameWords(local, remote.hash))) {
        mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: remote.hash }
        waiting?.wrote?.(target)
        continue
      }

      const { content } = await api.readNote(token, remote.id)

      // Whether the copy up there says anything this machine has not said itself.
      //
      // Two ways it can be this device's own writing come back, and both of them are
      // things the device wrote down rather than worked out: the body the last pass
      // left the two agreeing on, and the body handed over whose answer never
      // arrived. Either way there is no second writer in it however far the file has
      // moved on since - the keystrokes after the push are simply what the push below
      // will offer next.
      //
      // And a mirror that threw its note table away to fit in storage cannot say
      // anything is news: the gap is its own doing. A folder freshly paired with a
      // space that already held notes is the case that looks exactly like it and is
      // not, and there both copies are kept; see `dropped` in mirror.ts.
      //
      // The old rule was the other way round - anything that did not match the one
      // hash the last pass recorded counted as somebody else's writing - and on a
      // machine that is the only one there is, that is every note being typed in
      // whenever a reply went missing. Whose writing this is, is recorded, never
      // inferred from two hashes failing to match.
      const news =
        remote.hash !== tracked?.hash &&
        !(remote.hash && remote.hash === mirror.offered[remote.path]) &&
        !(tracked === undefined && mirror.dropped)

      // Whether the file here also carries writing the account has never seen, which
      // is the other half of a disagreement. With an entry to compare against the
      // answer is exact: a file whose words have moved since the last pass was
      // written here. Without one - a storage wiped, a folder paired for the first
      // time - the account is asked whether the note ever said these words: a copy
      // that is only behind the account's is brought up to date, and any other is
      // kept beside it. See sync/ancestry.ts.
      //
      // A note in a room is the exception either way: the room settled the two
      // character by character before either of them ever became a file. And the
      // app's own welcome note is nobody's writing, so it is simply replaced.
      const diverged =
        local !== null &&
        news &&
        !joined.has(remote.id) &&
        !isUntouchedWelcome(remote.path, local) &&
        (tracked === undefined
          ? !(await onlyBehind(token, remote.id, local))
          : !(await holdsSameWords(local, tracked.hash)))

      // Nothing up there this machine has not said, and a file that has moved on
      // since it said it. The version is written down so the pass stops asking, and
      // the file is left exactly as it is for the push below to offer. Writing the
      // account's copy over it is what the line at the bottom does, and it would
      // throw away every keystroke typed since the push.
      if (!news && local !== null && local !== content) {
        mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: remote.hash }
        continue
      }

      if (diverged && local !== content) {
        // A canvas is put back together rather than copied: both drawings are
        // kept, and what is written here is already the answer both devices
        // will settle on, since the merge gives the same file either way round.
        // Which is the same answer under every rule: nothing was lost, so there
        // is nothing to choose between.
        // A page note merges the way a canvas does, because it is the same file: the
        // same objects with the same ids and the same times, so the union keeps every
        // stroke either device wrote and every page either of them added.
        //
        // The merge itself is fetched by the first plane that needs one: it is the
        // whole JSON Canvas format, and a pass that has only notes in it has nothing
        // to merge. See canvas-merge.ts.
        //
        // A web note is settled too, the newer copy standing with the fields only the
        // other one said carried across: it is a tab written down, two devices browsing
        // one site write it seconds apart, and a copy beside it for each of those was
        // a file list full of them. So under every rule. See web-tab/settle.ts.
        const together = await settled(remote.path, local, content, () =>
          theirsIsNewer(target, remote.updatedAt),
        )

        if (together !== null) {
          await writeDown(target, together, local)
          // The account's copy, which the merged file is now ahead of: the push
          // below sees the two differ and sends, and a room joined afterwards is
          // told the truth about what the account last handed this device. An
          // empty hash used to stand here to force that push, and a room reading
          // it matched neither side and asked for a conflict copy of its own; see
          // `startedFrom` in rooms/room.ts.
          mirror.notes[remote.path] = {
            id: remote.id,
            version: remote.version,
            hash: remote.hash,
          }
          waiting?.wrote?.(target)
          continue
        }

        // Both wrote since the words they last agreed on, and those words are known:
        // edits that meet nowhere are one note again, under every rule, because there
        // is nothing to choose between. What the file said is kept as a version on the
        // way past, and the push below sends the merge on top of the account's copy.
        const merged = tracked
          ? await mergedOver(token, target, remote.id, tracked.hash, local, content)
          : null
        if (merged !== null) {
          await writeDown(target, merged, local)
          mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: remote.hash }
          waiting?.wrote?.(target)
          continue
        }

        const rule = waiting?.rule ?? DEFAULT_RULE

        // Left exactly as it is, with the other copy held for somebody to look
        // at. The entry takes the version we just saw so the pass stops asking
        // about it, and `held` keeps the push below from sending ours over it.
        if (rule === 'ask') {
          waiting?.clashed?.({
            path: target,
            id: remote.id,
            version: remote.version,
            theirs: content,
            at: Date.now(),
          })

          // The one place an empty hash is the truth: nothing was settled, so there
          // is no body the two sides agree on. A room joining this note reads it as
          // "I cannot tell" and asks the same question again rather than writing
          // either copy over the other, which is what `ask` means.
          mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: '' }
          continue
        }

        // The later of the two stands. What loses is in this device's own
        // history either way - `writeDown` keeps it on the way past - which is
        // what makes this safe rather than lossy.
        if (rule === 'newest' && (await theirsIsNewer(target, remote.updatedAt))) {
          await writeDown(target, content, local)
          mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: remote.hash }
          waiting?.wrote?.(target)
          continue
        }

        if (rule === 'both') await writeDown(conflictPath(target), content)

        // The account's copy, which ours is now beside rather than in step with:
        // the push below sees the two differ and sends ours on top of the version
        // we just saw, so it lands as the newest one. Truthful rather than empty,
        // for the reason the merge above gives.
        mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: remote.hash }
        waiting?.wrote?.(target)
        continue
      }

      await writeDown(target, content, local)
      mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: remote.hash }
      waiting?.wrote?.(target)
    }

    // A page saying there is more that hands back the cursor it was given would
    // be asked for forever: the pass would never end, the loop would never set
    // its next timer, and a first sync would never let anybody in.
    // A move left half done is asked about again: the next pass reads this page once
    // more, and everything else on it is already settled, so only the moves are new.
    if (waits.size) break

    const asked = mirror.cursor
    mirror.cursor = page.cursor
    if (!page.more || page.cursor === asked) break
  }

  return moved
}

/** Notes another device renamed or moved, moved here to match, so the pull below
 *  settles each at its new name the way it settles any other note.
 *
 *  The account keeps one row per note and changes its path in place, so a rename
 *  there arrives as the same id under a new name and nothing at all about the old
 *  one. Looked up by path alone it was a note this machine had never seen: written
 *  down beside the old file, with both names in the table under one id. The old name
 *  then stayed on the disk for good, deleting it deleted the live note on every
 *  device, and typing in it was refused and kept as a conflict copy.
 *
 *  What moves is the file, with whatever was typed in it since the last pass, and
 *  the entry with it: the version and hash the two sides last agreed on. So below, a
 *  file nobody wrote in takes the account's words, one written in here goes up under
 *  the new name, and one written in on both sides is merged, kept twice or asked
 *  about, as any note is. The rename goes through `rename_note`, which takes a page
 *  note's paper along as a rename made here does.
 *
 *  All of a page's moves are settled together, because a new name can still be
 *  another moving note's here: two notes that swapped names, or three that went round.
 *  Taken one at a time, the first found its name held and was let go, and the pull
 *  then wrote its words over the other note's file under the other note's id, which
 *  the push sent everywhere. So a move whose name no entry holds goes, and when none
 *  can, the note in the way waits aside under a name of its own, as sync v2's
 *  `settle` does. The aside name keeps the file's own name at its end, so a page
 *  note's paper follows it there and back. Every entry stays at the name its file
 *  has, and the record is written down around each rename, so a quit anywhere in a
 *  round leaves the next pass knowing where each note's file is.
 *
 *  A file already gone from the old name went away here, and the entry moves anyway,
 *  so the push reads the gap as the delete it always has. A file found aside instead,
 *  left there by a pass that quit halfway, is the note's file and moves on from there.
 *  Where the file cannot move (the new name is another note's here, or a file nothing
 *  tracks, or the rename is refused) the file is kept and its entry let go: it goes up
 *  as a note of its own rather than being the note, and nothing here can delete the
 *  one that moved. A swap or a round that cannot finish is the exception: its notes
 *  keep their files and entries, and wait for the next pass. Answers which. */
async function movedThere(
  mirror: Mirror,
  moves: readonly { remote: RemoteNote; was: string }[],
  waiting?: Waiting,
): Promise<Set<string>> {
  const full = (path: string) => joinPath(mirror.root, path)
  const pending: { id: string; was: string; at: string | null; now: string }[] = []

  for (const { remote, was } of moves) {
    if (mirror.notes[was]?.id !== remote.id) continue

    // A note is only ever set aside from its own file, so an aside of its name is its
    // file wherever the record says it is: written down from before a round that
    // stopped halfway, the record names the old file, which by then can hold the words
    // of the note that took its name.
    const aside = asideOf(was, remote.id)
    let at: string | null = null
    if (!isAside(was) && (await present(full(aside)))) {
      rekey(mirror, was, aside)
      at = aside
    } else if (await present(full(was))) {
      at = was
    }
    pending.push({ id: remote.id, was, at, now: remote.path })
  }

  // Every rename is written down twice: what it is about to do before it, and where
  // the file is after it, so a quit at any point leaves a record the next pass can
  // finish from exactly. See `journalled`.
  const move = async (one: (typeof pending)[number], to: string): Promise<boolean> => {
    const from = one.at
    if (from === null) return false
    mirror.moving = { id: one.id, from, to }
    waiting?.save?.()
    const done = await invoke('rename_note', { from: full(from), to: full(to) }).then(
      () => true,
      (error: unknown) => {
        log('warn', `sync: ${full(from)} not moved to ${full(to)} - ${String(error)}`)
        return false
      },
    )
    if (done) {
      rekey(mirror, from, to)
      one.at = to
    }
    delete mirror.moving
    waiting?.save?.()
    // Told as made, from where the file really was: a step aside too. What follows a
    // file by its path hears each step in turn, so told only from the old name to the
    // new, in a swap the second note's open document went to its new name and then on
    // with the first note's file, and saved its words over that one.
    if (done) await waiting?.moved?.(full(from), full(to))
    return done
  }

  const left = new Set(pending)
  const where = (one: (typeof pending)[number]) => one.at ?? one.was

  // Each round moves a note or sets one aside, and a note is set aside once at most.
  for (let round = 0; round <= 2 * pending.length && left.size; round += 1) {
    let progress = false
    for (const one of [...left]) {
      // The name is another note's here, by its entry: one still to move, or one
      // staying, which lets this one go below.
      if (mirror.notes[one.now]) continue
      const from = where(one)
      if (one.at === null) {
        // Gone from here, so there is no file to take along; the push reads the gap.
        rekey(mirror, from, one.now)
      } else if (!(await move(one, one.now))) {
        continue
      }
      left.delete(one)
      progress = true
    }
    if (progress) continue

    // Nothing could move, so every free name is taken. Where it is taken by another
    // moving note's file, that note steps aside and the next round goes on.
    const holder = [...left].find(
      (one) =>
        one.at !== null &&
        !isAside(one.at) &&
        [...left].some((other) => other !== one && other.now === one.at),
    )
    if (!holder?.at || !(await move(holder, asideOf(holder.at, holder.id)))) break
  }

  // A note whose name is another moving note's, or whose own name another moving note
  // wants, is one of a swap or a round that did not finish: a file held open, most
  // likely. Each such note keeps the file it has with its entry beside it, back at its
  // old name where that is free, and waits for the next pass. Let go instead, each
  // file was found at the other note's name, read as somebody's writing there and
  // sent up as the other note.
  const waits = new Set<string>()
  for (const one of left) {
    const tied = pending.some(
      (other) => other !== one && (other.was === one.now || other.now === one.was),
    )
    if (one.at !== null && isAside(one.at) && !mirror.notes[one.was]) {
      if (!(await present(full(one.was)))) await move(one, one.was)
    }
    if (tied) {
      waits.add(one.id)
      continue
    }

    // Anything else stays as a file of its own, in sight, and is no longer this note.
    const at = where(one)
    if (isAside(at)) await shownAgain(mirror, at, one.id, new Set(), waiting)
    const now = Object.keys(mirror.notes).find((path) => mirror.notes[path]?.id === one.id)
    if (now !== undefined) {
      mirror.notes = without(mirror.notes, now)
      mirror.offered = without(mirror.offered, now)
    }
  }
  return waits
}

/** An entry, and a write in the air about it, from one name to another. */
function rekey(mirror: Mirror, from: string, to: string) {
  const tracked = mirror.notes[from]
  if (!tracked || from === to) return
  const offered = mirror.offered[from]
  mirror.notes = { ...without(mirror.notes, from), [to]: tracked }
  mirror.offered = without(mirror.offered, from)
  if (offered !== undefined) mirror.offered = { ...mirror.offered, [to]: offered }
}

const ASIDE = '.nib-moving-'

/** Where a note waits while another takes its name, beside it and with its own name
 *  at the end, so a page note's paper goes along: `.nib-moving-<id>-<name>`. Hidden,
 *  so the list and the push never see it. */
function asideOf(path: string, id: string): string {
  const folder = folderOf(path)
  return `${folder ? `${folder}/` : ''}${ASIDE}${id}-${nameOf(path)}`
}

function isAside(path: string): boolean {
  return nameOf(path).startsWith(ASIDE)
}

/** Whether a file is there, read or stamped. */
async function present(path: string): Promise<boolean> {
  const read = await invoke<string>('read_note', { path }).then(
    () => true,
    () => false,
  )
  return read || (await fileStamp(path)) !== null
}

/** A note waiting aside put back in sight: at the name it was set aside from where
 *  that is free, else beside it, `A 2.md`, never over anything. Answers where it is
 *  now, with its entry, if it has one, re-keyed there. */
async function shownAgain(
  mirror: Pick<Mirror, 'root' | 'notes' | 'offered'>,
  aside: string,
  id: string,
  avoid: ReadonlySet<string>,
  waiting?: Waiting,
): Promise<string> {
  const full = (path: string) => joinPath(mirror.root, path)
  const prefix = `${ASIDE}${id}-`
  const name = nameOf(aside).startsWith(prefix)
    ? nameOf(aside).slice(prefix.length)
    : nameOf(aside).slice(ASIDE.length)
  const folder = folderOf(aside)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''

  for (let n = 1; n < 100; n += 1) {
    const path = `${folder ? `${folder}/` : ''}${n === 1 ? name : `${stem} ${n}${ext}`}`
    const theirs = mirror.notes[path] && mirror.notes[path].id !== id
    if (avoid.has(path) || theirs || (await present(full(path)))) continue
    const done = await invoke('rename_note', { from: full(aside), to: full(path) }).then(
      () => true,
      () => false,
    )
    if (!done) break
    if (mirror.notes[aside]) rekey(mirror as Mirror, aside, path)
    await waiting?.moved?.(full(aside), full(path))
    return path
  }
  log('warn', `sync: ${full(aside)} could not be put back in sight`)
  return aside
}

/** Finishes what the record says a quit cut short: a rename it was about to make,
 *  found made or not by where the file is. See `movedThere`. */
async function journalled(mirror: Mirror): Promise<void> {
  const moving = mirror.moving
  if (!moving) return
  delete mirror.moving
  if (mirror.notes[moving.from]?.id !== moving.id || mirror.notes[moving.to]) return

  const full = (path: string) => joinPath(mirror.root, path)
  if (!(await present(full(moving.from))) && (await present(full(moving.to)))) {
    rekey(mirror, moving.from, moving.to)
  }
}

/** A v1 record made whole before sync v2 reads the folder by it: a rename a quit cut
 *  short is settled, and a note waiting aside from a swap v1 did not finish is put
 *  back in sight. Read as it was, the hidden file was a note gone from the disk, and
 *  v2 sent its delete. Answers the notes by where each file now is. */
export async function asidesBack(
  root: string,
  notes: Readonly<Record<string, Tracked>>,
  moving?: Moving,
): Promise<Record<string, Tracked>> {
  const record = { root, notes: { ...notes }, offered: {}, ...(moving ? { moving } : {}) }
  await journalled(record as Mirror)
  for (const path of Object.keys(record.notes)) {
    if (isAside(path) && (await present(joinPath(root, path)))) {
      await shownAgain(record, path, record.notes[path]?.id ?? '', new Set())
    }
  }
  return record.notes
}

/** The notes of a swap or a round that `pull` could not finish, by mirror, which the
 *  push after it leaves alone: their entries may name where a file waits rather than
 *  where the account has it. Asked about again by the next pull. */
const unsettled = new WeakMap<Mirror, ReadonlySet<string>>()

/** Whether a file with no entry is word for word something its note once said on the
 *  account, so only behind it. Either line ending, as `holdsSameWords` reads one. */
async function onlyBehind(token: string, id: string, local: string): Promise<boolean> {
  const hashes = [await sha256(local)]
  if (local.includes('\r')) hashes.push(await sha256(unixLines(local)))

  const found = await behind(
    token,
    hashes.map((hash) => ({ id, hash })),
  )
  return found.has(id)
}

/** The file here and the account's copy as one note, merged against the words both
 *  last agreed on (`base`, a hash), or null where the two overlap or that base was
 *  never kept. Planes and web notes are settled before this is asked. Never in the
 *  glasses' plugin, which keeps both copies; see merging.ts. */
async function mergedOver(
  token: string,
  path: string,
  id: string,
  base: string,
  local: string,
  remote: string,
): Promise<string | null> {
  if (__EVEN_PLUGIN__) return null

  const ancestor = await baseOf(token, path, id, base)
  if (ancestor === null) return null

  const { mergedCleanly } = await import('./merging')
  return mergedCleanly(ancestor, unixLines(local), remote)
}

/** A note another device deleted, taken off this one - unless this one has written
 *  in it since.
 *
 *  The delete was made looking at the copy the account held, so that copy is what it
 *  takes away. A file here whose words have moved on since the last pass holds
 *  writing the other device never saw, and removing it used to lose that writing for
 *  good: the account's Recently deleted has only what the account was given. So the
 *  edit beats the delete, as sync v2 decides it (docs/sync-v2.md): the file stays,
 *  its entry goes, and the push below offers it as the new note it now is. A file
 *  that will not read stays the same way, since nothing can say it has not moved.
 *
 *  A file with nothing new in it goes, but to this device's trash rather than off the
 *  disk, with a version kept first the way a delete made here keeps one. A note in a
 *  room counts as unchanged: the room carried every keystroke up as it was typed.
 *
 *  A delete names a note, not a path, and the name may be another note's by now - one
 *  made there since, that a create here was paired with. That note is left alone. */
async function deletedThere(
  mirror: Mirror,
  remote: RemoteNote,
  here: string,
  joined: Joined,
  kept: boolean,
  named: ReadonlySet<string>,
  waiting?: Waiting,
) {
  const tracked = mirror.notes[here]
  if (tracked && tracked.id !== remote.id) return

  // A write that was in the air about a note that has since gone says nothing
  // about whatever is made at that name next.
  mirror.offered = without(mirror.offered, remote.path)
  if (!tracked) return

  // Waiting aside from a swap a pass did not finish: put back in sight first, so what
  // is kept or trashed below is a file somebody can find.
  const path = isAside(here) ? await shownAgain(mirror, here, remote.id, named, waiting) : here
  mirror.offered = without(mirror.offered, path)
  mirror.notes = without(mirror.notes, path)
  const target = joinPath(mirror.root, path)

  const local = await invoke<string>('read_note', { path: target }).catch(() => null)
  if (local === null && (await fileStamp(target)) === null) return

  if (local === null || !(joined.has(remote.id) || (await holdsSameWords(local, tracked.hash)))) {
    log('info', `sync: ${target} was deleted elsewhere after it was written in here, so it stays`)
    return
  }

  // Archived here, and nothing archived is deleted. The entry has gone from the mirror
  // above, so the push sends the file up again as the note it still is.
  if (kept) {
    log('info', `sync: ${target} was deleted elsewhere and is archived here, so it stays`)
    return
  }

  await invoke('snapshot_note', { path: target, content: local }).catch(() => undefined)
  await invoke('trash_item', { path: target, kind: 'note' }).catch((error: unknown) => {
    log(
      'warn',
      `sync: ${target} was deleted elsewhere and stays, the trash refused it - ${String(error)}`,
    )
  })
}

/** A note or a folder that moved here - renamed, or dragged into another folder -
 *  told to the account, so that the note keeps the id it has always had.
 *
 *  A note is a row up there with an id, and everything that outlives one sitting
 *  hangs off it: the version history, the room every device in the note joins, what
 *  a published link points at. A rename changes the name of a file. It is not a note
 *  ending and another beginning, and it must not reach the account as one.
 *
 *  Nothing used to tell the account anything, so the next pass read the move off the
 *  folder: the new name a path the mirror had never seen, which went up as a brand
 *  new note with a fresh uuid, and the old name a path with no file, which was
 *  deleted. The history ended there, the open room was left named after an id nothing
 *  answered to, and where the filesystem does not care about case a rename that only
 *  changed case was a second row over one file.
 *
 *  A folder is this said once per note under it.
 *
 *  The table here is re-keyed only once the account has taken the new name, and that
 *  order is the whole safety of it: a table saying a note lives at a name the account
 *  has never heard of is worse than one that is merely behind, because the next pull
 *  reads the account's copy as a note this machine has never seen, does not find the
 *  file, and writes the old name back onto the disk. So a request that does not land
 *  leaves the entry where it was, and the rename is written down beside it to be told
 *  again by the next pull; see `untold` in mirror.ts.
 *
 *  Answers whether the record changed, so the caller knows to write the mirrors
 *  down. */
export async function movedHere(
  mirror: Mirror,
  token: string,
  from: string,
  to: string,
  held: ReadonlySet<string> = new Set(),
  clashed?: (clash: Clash) => void,
): Promise<boolean> {
  const was = within(mirror.root, from)
  const now = within(mirror.root, to)
  if (was === null || now === null) return false

  // The file itself, and - for a folder - every note under it. `Kept/` rather than
  // `Kept`, or a folder would carry `Keptish.md` along with it.
  //
  // Except an entry whose rename is still to be told: it stays at the name its file
  // left, so whatever file is at that name now is another note, unless this is that
  // very rename told again. Taken for the note, the next note made at the name and
  // renamed was told as this note's rename, with its words and its id.
  const under = `${was}/`
  const moving = Object.entries(mirror.notes)
    .filter(([path, one]) => {
      if (path !== was && !path.startsWith(under)) return false
      const untold = mirror.untold?.[one.id]
      return !untold || untold.to === now + path.slice(was.length)
    })
    .map(([path]) => path)

  let done = false
  // A note whose rename is still to be told, moving on again before it was: told
  // where it is now.
  for (const [id, one] of Object.entries(mirror.untold ?? {})) {
    if (one.to !== was && !one.to.startsWith(under)) continue
    const to = now + one.to.slice(was.length)
    if (to === one.from) told(mirror, id)
    else mirror.untold = { ...mirror.untold, [id]: { ...one, to } }
    done = true
  }

  for (const path of moving) {
    const to = now + path.slice(was.length)
    if (await movedOne(mirror, token, path, to, held, clashed)) done = true
  }

  return done
}

/** The renames the account could not be told of, told again; see `untold` in
 *  mirror.ts. `asked` is the notes waiting on a question now, by id: a rename told
 *  again after the answer carries the file's words, which are the answer.
 *
 *  One whose file has gone since is let go of, and the pass reads what happened off
 *  the folder the way it always has. One another device renamed meanwhile takes the
 *  name the account has: the entry moves to where the file is, and the pull below
 *  moves the file on as it moves any note renamed there. Told from here instead, the
 *  older of the two renames went over the newer, and an entry the pull had moved
 *  without its file was a note gone here. Answers whether anything changed. */
async function toldAgain(
  mirror: Mirror,
  token: string,
  asked: ReadonlySet<string> = new Set(),
  clashed?: (clash: Clash) => void,
): Promise<boolean> {
  let done = false
  for (const [id, one] of Object.entries(mirror.untold ?? {})) {
    done = true
    if (mirror.notes[one.from]?.id !== id || !(await present(joinPath(mirror.root, one.to)))) {
      told(mirror, id)
      continue
    }
    if (mirror.notes[one.to]) {
      letGo(mirror, id, one.from, one.to, 'its new name is another note')
      continue
    }

    const there = await api.readNote(token, id).catch((error: unknown) => error)
    if (!isRecord(there) || !isRecord(there.note)) {
      untoldBy(mirror, id, one.from, one.to, there)
      continue
    }
    if (there.note.deleted === true) {
      letGo(mirror, id, one.from, one.to, 'the account has deleted it')
      continue
    }
    if (there.note.path !== one.from && there.note.path !== one.to) {
      log('warn', `sync: ${one.to} was renamed on another device too, and takes that name`)
      rekey(mirror, one.from, one.to)
      told(mirror, id)
      continue
    }

    await movedOne(
      mirror,
      token,
      one.from,
      one.to,
      asked.has(id) ? new Set([id]) : new Set(),
      clashed,
    )
  }
  return done
}

/** A rename the account has taken, or that is no longer to be told. */
function told(mirror: Mirror, id: string) {
  if (!mirror.untold?.[id]) return
  const left = without(mirror.untold, id)
  if (Object.keys(left).length) mirror.untold = left
  else delete mirror.untold
}

/** How often the account may refuse a rename before it is given up on. */
const MOST_TRIES = 5

/** A rename that did not land, written down to be told again - unless the account
 *  has said it never will take it, or has refused it too often. */
function untoldBy(mirror: Mirror, id: string, from: string, to: string, error: unknown) {
  // Only the account judging the rename counts. A network that is down refuses
  // nothing, and nor does a server that is failing: a 5xx is an outage or a room not
  // answering, and counted, a short one let the rename go and made it two notes.
  const judged = error instanceof ApiError && error.status < 500
  const tries = (mirror.untold?.[id]?.tries ?? 0) + (judged ? 1 : 0)
  const forGood =
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    ![408, 409, 429].includes(error.status)
  if (forGood || tries >= MOST_TRIES) {
    letGo(mirror, id, from, to, `the account refused it - ${String(error)}`)
    return
  }
  mirror.untold = { ...mirror.untold, [id]: { from, to, tries } }
}

/** A rename given up on. The entry goes with it rather than staying to be read as a
 *  delete: the file goes up as a note of its own, the account's copy comes back down
 *  under its old name, and nothing on either side is lost. */
function letGo(mirror: Mirror, id: string, from: string, to: string, why: string) {
  told(mirror, id)
  if (mirror.notes[from]?.id !== id) return
  log('warn', `sync: ${to} not renamed on the account, so it goes up as a new note: ${why}`)
  mirror.notes = without(mirror.notes, from)
  mirror.offered = without(mirror.offered, from)
}

async function movedOne(
  mirror: Mirror,
  token: string,
  was: string,
  now: string,
  held: ReadonlySet<string>,
  clashed?: (clash: Clash) => void,
): Promise<boolean> {
  const tracked = mirror.notes[was]
  // A note the account has never been handed has no identity to keep. It goes up
  // under its new name the first time a push meets it, which is right.
  if (!tracked) return false
  // Moved aside under another sync tool's name - Proton does this to its side of a
  // clash - is not this note being renamed: the account keeps the note where it was.
  if (inForeignCopy(now) && !inForeignCopy(was)) return false

  const content = await invoke<string>('read_note', {
    path: joinPath(mirror.root, now),
  }).catch(() => null)
  if (content === null) return false

  // Not told, the rename is written down to be told again: the entry stays at the
  // old name until the account has the new one. Left to the push, the file went up as
  // a new note beside a delete of this one - with whatever another device had written
  // in it since, and for a note waiting on a question even once it was answered - and
  // a new file at the old name went up as this note. See `untold` in mirror.ts.
  try {
    // A note whose two copies wait for an answer is moved up there with the words the
    // account already holds, and stays waiting: the rename is not an answer. Sent with
    // the file's words, the copy nobody had looked at yet was written over. See
    // sync/record.svelte.ts.
    if (held.has(tracked.id)) {
      const moved = await heldMovedUpThere(token, tracked, now)
      // The question is asked again of what was read: the account may hold newer
      // words than it was first asked about, and its version moved with the rename.
      clashed?.({
        path: joinPath(mirror.root, now),
        id: tracked.id,
        version: moved.tracked.version,
        theirs: moved.words,
        at: Date.now(),
      })
      mirror.notes = { ...without(mirror.notes, was), [now]: moved.tracked }
    } else {
      const moved = await renamedUpThere(token, tracked, now, content)
      mirror.notes = { ...without(mirror.notes, was), [now]: moved }
    }
  } catch (error) {
    untoldBy(mirror, tracked.id, was, now, error)
    return true
  }

  told(mirror, tracked.id)
  // A write that was in the air about the old name says nothing about the new one.
  mirror.offered = without(mirror.offered, was)

  return true
}

/** A note waiting on a question, at its new name on the account with the account's
 *  own words. Throws when that could not be said. The entry keeps its hash, which
 *  says nothing is settled. */
async function heldMovedUpThere(
  token: string,
  tracked: Tracked,
  path: string,
): Promise<{ tracked: Tracked; words: string }> {
  const there = await api.readNote(token, tracked.id)
  const { note } = await api.writeNote(token, tracked.id, path, there.content, there.note.version)
  return {
    tracked: { id: note.id, version: note.version, hash: tracked.hash },
    words: there.content,
  }
}

/** The entry for the note at its new name, once the account has it there. Throws
 *  when that could not be said.
 *
 *  A version the account has moved past is almost always this note's own room. The
 *  note somebody renames is the note they are reading, the note they are reading is
 *  the note a room is carrying, and a room writes its keystrokes up one at a time
 *  while the version the last pass wrote down stays where it was. The room names the
 *  note by its id and never says where it lives, so this is the only thing that can
 *  move it - and what it moves is what the room wrote, read back and put down again
 *  under the new name, rather than the file this machine happens to hold.
 *
 *  Almost always, not always: another device can have written the note while this
 *  one, still holding the older words, renamed it. So what the account moved to the
 *  new name is not taken as something this machine agrees with. The entry keeps the
 *  version and the hash the last pass left the two agreeing on, under the new name,
 *  and the next pull settles the account's copy against the file the way it settles
 *  any version it has not seen: brought down over a file nobody wrote in, and kept
 *  both or asked about over one somebody did. Recording the account's hash instead
 *  read that copy as agreed, and the push after it sent the older file over the
 *  other device's words with nothing in the way. A room's copy comes down the same
 *  way, since a note in a room is never a disagreement. */
async function renamedUpThere(
  token: string,
  tracked: Tracked,
  path: string,
  content: string,
): Promise<Tracked> {
  try {
    const { note } = await api.writeNote(token, tracked.id, path, content, tracked.version)
    return { id: note.id, version: note.version, hash: note.hash }
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error
  }

  const held = await api.readNote(token, tracked.id)
  await api.writeNote(token, tracked.id, path, held.content, held.note.version)
  return tracked
}

/** Offers what this machine has. Answers whether anything moved. */
/** What the caller wants to know about, and to keep out of, a push. */
export interface Sending {
  /** Notes waiting for an answer about two copies, which are not sent: sending
   *  one is what would write over the copy nobody has read yet. Paths as this
   *  machine spells them; see sync/conflicts.ts. */
  held?: ReadonlySet<string>
  /** The same notes by id, which a file gone from its name does not delete: the note
   *  may have been renamed while the account could not be told. */
  asked?: ReadonlySet<string>
  /** One note sent, by its path in the space. What the log counts. */
  sent?: (path: string) => void
  /** A web note's old copy folded into the note, both as this machine spells them;
   *  see web-copies.ts. */
  folded?: (one: Folded) => void
}

export async function push(
  mirror: Mirror,
  token: string,
  joined: Joined,
  sending: Sending = {},
): Promise<boolean> {
  const held = sending.held ?? new Set<string>()
  // Read once, for the same reason as in `pull`.
  const root = mirror.root
  // With the papers page notes hold, which the list leaves out: a paper goes up the
  // way any PDF does, below.
  const tree = await invoke<Entry>('read_tree', { root, options: { papers: true } }).catch(
    () => null,
  )
  if (!tree) return false
  const waits = unsettled.get(mirror) ?? new Set<string>()

  // The copies of web notes earlier passes made, folded back into their notes before
  // anything is offered: a copy that went is a file that vanished here, which the
  // loop at the bottom deletes on the account. See web-copies.ts.
  // Another sync tool's copies are left out from the start, whether the account has
  // ever had one or not: nothing about one is sent, and the loop at the bottom deletes
  // none (`inForeignCopy`). Meeting one fetches the mark the file list gives them.
  const all = flatten(tree)
  const everything = all.filter((one) => !inForeignCopy(relativeTo(root, one.path)))
  if (!__EVEN_PLUGIN__ && everything.length < all.length) void syncMark.ask()
  const folded = await foldWebCopies(everything)
  for (const one of folded) sending.folded?.(one)
  const listed = everything.filter((one) => !folded.some((fold) => fold.gone === one.path))
  const seen = new Set<string>()
  let moved = folded.length > 0
  // Where notes whose renames the account is still to hear of are now; see `untold`
  // in mirror.ts.
  const untold = mirror.untold ?? {}
  const renamed = new Set(Object.values(untold).map((one) => one.to))

  // A PDF is bytes rather than words, so it goes up as a blob and the space
  // records where in it the file sits; see `pushFiles`.
  if (await pushFiles(mirror, root, listed, token)) moved = true

  for (const file of listed.filter((one) => !isPdfTarget(one.name))) {
    const path = relativeTo(root, file.path)
    seen.add(path)

    // A note whose two copies are still waiting for an answer stays where it is,
    // on both sides: this is the one file the pass deliberately leaves alone.
    if (held.has(file.path)) continue

    // Left out when unreadable, rather than ending the pass for all after it.
    const content = await invoke<string>('read_note', { path: file.path }).catch(
      (error: unknown) => {
        log('warn', `sync: ${file.path} not sent - ${String(error)}`)
        return null
      },
    )
    if (content === null) continue

    const hash = await sha256(content)
    const tracked = mirror.notes[path]
    // Still on its way to the name the account has for it; see `movedThere`.
    if (tracked && waits.has(tracked.id)) continue
    // Or to the name it has here: the note is at the new name, and a file at the old
    // one is another.
    if (tracked ? untold[tracked.id] : renamed.has(path)) continue

    if (!tracked) {
      // The app's own welcome note, exactly as the app wrote it, is not writing
      // and does not belong in anybody's account. It used to go up on every launch
      // of the plugin, whose storage is empty every launch, and come back each time
      // Emil deleted it. A character typed into it makes it his and it travels like
      // any other note. See welcome.ts.
      if (isUntouchedWelcome(path, content)) continue

      if (await create(mirror, token, path, content)) moved = true
      continue
    }

    if (tracked.hash === hash) continue

    // A note in a room has already been carried up by the room, keystroke by
    // keystroke, and the room is what writes it into the account. Sending the file
    // as well would be a second writer for one note.
    if (joined.has(tracked.id)) {
      continue
    }

    moved = true

    // Said before the request goes out, because the case it answers is the answer
    // that never comes back: the write lands, the reply is lost, and this is the
    // only record that the copy the account now holds is this machine's own. See
    // `offered` in mirror.ts and `news` in `pull`.
    mirror.offered = { ...mirror.offered, [path]: hash }

    try {
      const { note } = await api.writeNote(token, tracked.id, path, content, tracked.version)
      mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
      mirror.offered = without(mirror.offered, path)
      sending.sent?.(path)
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error

      // The note's room settled while this write was in the air, which is this
      // device losing to itself: the version the account moved on to is its own
      // keystrokes, carried up one at a time by the room this same tab is in. The
      // file and the room are two ways out of one document, so nothing in what was
      // sent is missing from what landed. Where the account got to is written down
      // and the note is left to the room - which is where the question above would
      // have left it had it been asked a moment later. Asked now rather than trusted
      // from before the request, for the reason `Joined` gives.
      if (joined.has(tracked.id) && caughtUpWith(mirror, path, error.body)) continue

      await keepBoth(mirror, path, tracked, error.body, token, tracked.hash)
    }
  }

  // A file that vanished locally is a delete, not a gap.
  for (const [path, tracked] of Object.entries(mirror.notes)) {
    if (
      seen.has(path) ||
      inForeignCopy(path) ||
      waits.has(tracked.id) ||
      sending.asked?.has(tracked.id) ||
      untold[tracked.id]
    )
      continue

    // Its words wait aside, from a swap a pass did not get to finish, and are never
    // read as a note gone from here: the next pull moves it on or puts it back.
    if (isAside(path) && (await present(joinPath(root, path)))) continue
    const aside = asideOf(path, tracked.id)
    if (await present(joinPath(root, aside))) {
      await shownAgain(mirror, aside, tracked.id, new Set())
      continue
    }

    if (!(await deletedOnAccount(token, tracked.id))) continue

    mirror.notes = without(mirror.notes, path)
    mirror.offered = without(mirror.offered, path)
    moved = true
  }

  return moved
}

/** Whether the account took a delete, or never will. If not, the entry stays for
 *  the next pass: dropped, the next pull wrote the note back. */
async function deletedOnAccount(token: string, id: string): Promise<boolean> {
  try {
    await api.deleteNote(token, id)
    return true
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return true

    log('warn', `sync: delete of ${id} not taken - ${String(error)}`)
    return false
  }
}

/** The PDFs of a space, offered to the account so that a published note linking
 *  one can be served it.
 *
 *  A file goes up the way a pasted picture does: as a blob addressed by the hash
 *  of its bytes. What the space records is where each one sits, and the answer to
 *  that says which hashes the account holds no blob for - which is what makes the
 *  bytes of a thirty megabyte paper travel once and never again.
 *
 *  Nothing comes back down. The list is what makes a paper reachable from a
 *  published page; a second machine gets its PDFs the way it got them the first
 *  time, which is by somebody putting them in the folder. */
async function pushFiles(
  mirror: Mirror,
  root: string,
  listed: readonly Entry[],
  token: string,
): Promise<boolean> {
  const held: Record<string, TrackedFile> = {}
  const manifest: SpaceFile[] = []

  for (const file of listed) {
    const path = relativeTo(root, file.path)
    if (!isPdfTarget(file.name) && !dressesTheSite(path)) continue

    const tracked = mirror.files[path]
    // Read and hashed again only when the file has been written since, so a
    // paper nobody has touched costs nothing at all.
    const hash = tracked?.modified === file.modified ? tracked.hash : await hashFile(file.path)
    if (hash === null) continue

    held[path] = { hash, modified: file.modified }
    manifest.push({ path, hash })
  }

  if (same(mirror.files, held)) return false

  const { missing } = await api.saveSpaceFiles(token, mirror.spaceId, manifest)

  // What the account could not keep is what it has no bytes for. Those go up
  // now, and the list is offered again so their rows land as well.
  const unsent = new Set<string>()
  if (missing.length) {
    const wanted = new Set(missing)

    for (const file of manifest) {
      if (!wanted.has(file.hash)) continue

      const bytes = await invoke<ArrayBuffer>('read_file', {
        path: joinPath(root, file.path),
      }).catch(() => null)
      if (bytes) await api.putBlob(token, file.hash, contentTypeOf(file.path), bytes)
      // A file that would not read was never sent, so the mirror must not say it
      // was: `holds` reads it to leave a delete to the account (sync/holding.ts),
      // and the next pass offers it again.
      else unsent.add(file.path)
    }

    await api.saveSpaceFiles(token, mirror.spaceId, manifest)
  }

  mirror.files = Object.fromEntries(Object.entries(held).filter(([path]) => !unsent.has(path)))
  return true
}

/** The two files a site is dressed with, by Obsidian Publish's own names: a
 *  stylesheet and a script at the root of the space. They travel with the papers
 *  because they travel the same way - the bytes as a blob, the name in the
 *  space's list - and a space that has neither is unaffected. See
 *  docs/publishing.md. */
const DRESSING = new Set(['publish.css', 'publish.js'])

function dressesTheSite(path: string): boolean {
  return DRESSING.has(path.toLowerCase())
}

function contentTypeOf(path: string): string {
  if (path.toLowerCase().endsWith('.css')) return 'text/css'
  if (path.toLowerCase().endsWith('.js')) return 'text/javascript'

  return 'application/pdf'
}

/** The hash of a file's bytes, or null when it cannot be read - a paper deleted
 *  between the listing and here is nothing to report. */
async function hashFile(path: string): Promise<string | null> {
  const bytes = await invoke<ArrayBuffer>('read_file', { path }).catch(() => null)
  return bytes === null ? null : sha256(bytes)
}

/** Whether two lists of files say the same thing, so a space nobody has changed
 *  costs no request at all. */
function same(was: Record<string, TrackedFile>, now: Record<string, TrackedFile>): boolean {
  const paths = Object.keys(now)

  return (
    paths.length === Object.keys(was).length &&
    paths.every((path) => was[path]?.hash === now[path]?.hash)
  )
}

/** Never silently drop an edit. A canvas is merged into one file that has
 *  everything both devices drew; anything else keeps the other side's copy
 *  beside ours, since two people typing in one paragraph cannot be settled by a
 *  machine. */
/** A note this machine has and the mirror has never heard of, offered to the
 *  account.
 *
 *  The account may already hold that path - this machine forgot its mirror, two
 *  devices made the same note, a folder was moved back - and the space allows one
 *  live note per path, so it answers 409 with the note that is there. That is a
 *  pairing, not a failure: the two are recorded as one note, and whichever text
 *  differs is settled the way any other conflict is. Before this, the 409 threw
 *  and took the whole pass with it, and the pass came round again to throw again.
 *
 *  Answers whether anything moved. */
async function create(
  mirror: Mirror,
  token: string,
  path: string,
  content: string,
): Promise<boolean> {
  // For the reason the push gives: a create whose answer is lost leaves the account
  // holding a note this machine has no entry for and made itself.
  const offered = await sha256(content)
  mirror.offered = { ...mirror.offered, [path]: offered }

  try {
    const { note } = await api.createNote(token, mirror.spaceId, path, content)
    mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
    mirror.offered = without(mirror.offered, path)
    return true
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error

    const body = isRecord(error.body) ? error.body : {}
    const theirs = isRecord(body.note) ? body.note : null
    if (!isString(theirs?.id) || !isNumber(theirs.version) || !isString(theirs.hash)) throw error

    const tracked: Tracked = { id: theirs.id, version: theirs.version, hash: theirs.hash }
    mirror.notes[path] = tracked

    // The same words on both sides: paired, and there is nothing to send. Told by
    // the account's own hash rather than by hashing again, which is what the rest
    // of this file compares against too.
    const hash = await sha256(content)
    if (hash === tracked.hash) {
      mirror.offered = without(mirror.offered, path)
      return false
    }

    // The note up there is one this machine wrote itself, on a pass whose answer
    // never arrived - the create landed, the reply did not, and there is no entry
    // because of it. Paired and left to the next push, which offers what the file
    // says now. A second copy of somebody's own note is not an answer to anything.
    if (mirror.offered[path] && tracked.hash === mirror.offered[path]) return false

    // Two notes at one path with different words is the conflict this file has
    // always had an answer for: neither is dropped.
    await keepBoth(mirror, path, tracked, body, token, null)
    return true
  }
}

/** Where the account says it has got to, written down out of the refusal that says
 *  it. What the pass does with a note it has just learned it is behind on is ask
 *  about it from there rather than from the version it was refused on.
 *
 *  Answers whether the refusal named a copy at all: a body that does not read as one
 *  says nothing to write down, and the caller settles it the way it always has. */
function caughtUpWith(mirror: Mirror, path: string, refusal: unknown): boolean {
  const body = isRecord(refusal) ? refusal : {}
  const theirs = isRecord(body.note) ? body.note : null
  if (!isString(theirs?.id) || !isNumber(theirs.version) || !isString(theirs.hash)) return false

  mirror.notes[path] = { id: theirs.id, version: theirs.version, hash: theirs.hash }
  // Nothing of this device's is in the air any more: the write it was about was
  // refused rather than lost. See `offered` in mirror.ts.
  mirror.offered = without(mirror.offered, path)
  return true
}

async function keepBoth(
  mirror: Mirror,
  path: string,
  tracked: Tracked,
  conflict: unknown,
  token: string,
  /** The hash of the words both sides last agreed on, when there are any: a write
   *  refused because the account moved on, as opposed to two notes made at one path. */
  base: string | null,
) {
  // The body of a 409 is whatever the server sent; only a real version to
  // base the next write on makes this worth doing at all.
  const server = isRecord(conflict) ? conflict : {}
  const theirs = isRecord(server.note) ? server.note : null
  if (typeof theirs?.version !== 'number') return

  const here = joinPath(mirror.root, path)
  const sent = isString(server.content) ? server.content : ''
  const ours = await invoke<string>('read_note', { path: here })

  // This device's write is the newer one: it is being made now.
  const together = await settled(path, ours, sent, () => Promise.resolve(false))
  if (together !== null) {
    await writeDown(here, together, ours)
    const { note } = await api.writeNote(token, tracked.id, path, together, theirs.version)
    mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
    return
  }

  const merged = base === null ? null : await mergedOver(token, here, tracked.id, base, ours, sent)
  if (merged !== null) {
    await writeDown(here, merged, ours)
    const { note } = await api.writeNote(token, tracked.id, path, merged, theirs.version)
    mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
    return
  }

  await writeDown(conflictPath(here), sent)

  // Our version is now the newer one; write it over the server's.
  const { note } = await api.writeNote(token, tracked.id, path, ours, theirs.version)
  mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
}
