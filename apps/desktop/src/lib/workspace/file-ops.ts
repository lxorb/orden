/** Every file operation, said once, by the operation that did it.
 *
 *  A good deal of the app keeps something by a file's path: where each note was
 *  being read, the notes opened lately, the bookmarks, a folder's icon and the order
 *  its rows were arranged in, what a space leaves out and what it put away, the link
 *  index, the papers' words, the open documents and the tabs' trails, and the
 *  account's id for each note. Every one of them has to hear when a path changes or
 *  goes, and each operation used to tell each of them by hand - so a store was
 *  missed wherever somebody forgot it: undo was missing the arranged order until a
 *  test caught it, the bookmarks were missing everywhere, and a folder that moved
 *  took none of the documents open inside it along.
 *
 *  So an operation says what it did, once, and whatever keeps files by path follows
 *  what is said; nothing an operation does names a store. VS Code's working copies
 *  and Obsidian's vault events are the same shape. See `follow` in
 *  workspace.svelte.ts for who follows, and docs/sync-v2.md for the account's part. */

import { log } from '../log'
import { movedTo, relativeTo, samePath, within } from '../space-paths'

/** What moved or went: a file, a folder with everything in it, or a whole space. */
export type Kind = 'file' | 'folder' | 'space'

/** One file operation. `root` is the space the path was in, which an agent's move
 *  in a space the reader is not looking at shows is not always the open one; null
 *  for a path in no space. A move's `into` is the space it landed in, which Move
 *  offers to make another one; left out, the same as `root`. A space moving is
 *  itself: its old root and its new. A file
 *  made for a document that was already open without one - a new tab given its place
 *  - names that document by its `key` (see documents.svelte.ts). */
export type FileOp =
  | {
      op: 'created'
      path: string
      kind: Exclude<Kind, 'space'>
      root: string | null
      key?: string
    }
  | {
      op: 'moved'
      from: string
      to: string
      kind: Kind
      root: string | null
      into?: string | null
    }
  | { op: 'removed'; path: string; kind: Kind; root: string | null }

/** Whatever keeps files by path. What it has left to do - telling the account - it
 *  answers as a promise, which the operation waits for before it goes on, so two
 *  operations in a row reach the account in the order they were done. */
export type Follower = (op: FileOp) => unknown

export class FileOps {
  private readonly followers = new Set<Follower>()

  /** Follows every operation from now on. Answers the way to stop. */
  follow(follower: Follower): () => void {
    this.followers.add(follower)
    return () => this.followers.delete(follower)
  }

  /** Says one operation to everything following, all of it in the same moment: a
   *  path that changes is changed everywhere before anything on the page can read
   *  one store's answer beside another's (a room asking the account's id of a path
   *  the documents already have and the account's table not yet). A follower that
   *  fails is written down and the rest still hear. */
  async tell(op: FileOp): Promise<void> {
    const waiting: Promise<unknown>[] = []

    for (const follower of this.followers) {
      try {
        const left = follower(op)
        if (left instanceof Promise) waiting.push(left.catch((error: unknown) => failed(op, error)))
      } catch (error) {
        failed(op, error)
      }
    }

    await Promise.all(waiting)
  }
}

function failed(op: FileOp, error: unknown) {
  log(
    'error',
    `a store did not follow ${op.op} ${op.op === 'moved' ? op.from : op.path}: ${String(error)}`,
  )
}

/** A store that keeps things by a path inside a space, under each space's root: the
 *  four sentences it takes, and the one place those are read off an operation. */
export interface KeptByPath {
  moved?(from: string, to: string, root: string | null, into?: string | null): void
  gone?(path: string, root: string | null): void
  spaceMoved?(from: string, to: string): void
  forget?(root: string): void
}

/** A store that keeps things by path, following every operation. */
export function keeping(store: KeptByPath): Follower {
  return (op) => {
    if (op.op === 'removed') {
      if (op.kind === 'space') store.forget?.(op.path)
      else store.gone?.(op.path, op.root)
    } else if (op.op === 'moved') {
      if (op.kind === 'space') store.spaceMoved?.(op.from, op.to)
      else store.moved?.(op.from, op.to, op.root, op.into === undefined ? op.root : op.into)
    }
  }
}

/** A move as a store kept by path hears it: `was` the path that moved, as the space
 *  it left speaks of it; `now` where it landed, as the space it landed in (`there`)
 *  speaks of it, or null where no space holds it any more. `across` for a move into
 *  another space, or out of every one: what a store holds about the path then leaves
 *  the source space's map, and goes into `there`'s relative to its root. A key
 *  rewritten relative to the source root would be a path on this disk, which the map
 *  drops on its next read, after it has been sent to the account. */
export interface Moving {
  root: string
  was: string
  there: string
  now: string | null
  across: boolean
}

export function moving(from: string, to: string, root: string, into?: string | null): Moving {
  const there = into ?? root
  const now = within(there, to, there)
  return {
    root,
    was: relativeTo(root, from),
    there,
    now,
    across: now === null || !samePath(there, root),
  }
}

/** A store's entries split by a move `across`: `left` what stays in the source space,
 *  `went` what moved with it, each rewritten by `at` to its path in the space it
 *  landed in. Nothing goes anywhere for a move out of every space. `pathOf` names the
 *  path an entry is about, or null for one about no path. */
export function carried<T>(
  held: Iterable<T>,
  move: Moving,
  pathOf: (one: T) => string | null,
  at: (one: T, path: string) => T,
): { left: T[]; went: T[] } {
  const left: T[] = []
  const went: T[] = []
  for (const one of held) {
    const path = pathOf(one)
    const landed =
      path === null || !move.was ? null : movedTo(path, move.was, move.now ?? '', move.root)
    if (landed === null) left.push(one)
    else if (move.now !== null) went.push(at(one, landed))
  }
  return { left, went }
}
