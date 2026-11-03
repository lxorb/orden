/** Whether the space a first visit was given is still nothing but what the app put in
 *  it (#1077): the one place that is decided.
 *
 *  Signing in to an account that already has spaces used to leave it behind, a `Notes`
 *  beside the account's own that the reader had to delete by hand. Untouched, it is
 *  nothing of theirs and goes; touched, it is theirs and travels like any space
 *  (space-plan.ts).
 *
 *  Untouched is decided by history and by content, never by name: the space the fresh
 *  start made or the browser seeded, at the root it was made at (seeded.ts), holding no
 *  folder and no file but the app's own seeds exactly as written - the welcome note
 *  (welcome.ts) and `AGENTS.md` (agents-seed.ts) - or fewer of them. A reader's own
 *  space called `Notes`, the default renamed, a word typed into either seed, a note or
 *  a picture added: each makes it theirs. Anything that cannot be read is theirs too. */

import { isUntouchedAgents } from './agents-seed'
import { isUntouchedWelcome } from './welcome'

/** One entry of a space's listing, as `read_tree` answers. */
export interface Listed {
  path: string
  is_dir: boolean
  children: Listed[]
  evicted?: boolean
  unlisted?: boolean
}

/** How the question reads a space: its listing and one note's words, null for none. */
export interface Reading {
  tree(root: string): Promise<Listed | null>
  note(path: string): Promise<string | null>
}

/** Whether a listing holds nothing but untouched seeds. */
async function holdsOnlySeeds(tree: Listed, read: Reading['note']): Promise<boolean> {
  for (const child of tree.children) {
    if (child.is_dir || child.evicted || child.unlisted) return false
    const words = await read(child.path)
    if (words === null) return false
    if (!isUntouchedWelcome(child.path, words) && !isUntouchedAgents(child.path, words)) {
      return false
    }
  }
  return true
}

/** The root of the default space among `roots`, where it is still untouched; null
 *  where there is none, or it is the reader's now. */
export async function untouchedSeedSpace(
  seeded: string | null,
  roots: readonly string[],
  read: Reading,
): Promise<string | null> {
  if (seeded === null || !roots.includes(seeded)) return null
  const tree = await read.tree(seeded).catch(() => null)
  if (!tree) return null
  return (await holdsOnlySeeds(tree, (path) => read.note(path).catch(() => null))) ? seeded : null
}
