/** Finding the notes that are commands, agents and output styles (notes.ts), in a
 *  space: the one in front for the menu, the thread's own for what a thread was told.
 *
 *  Asked of the space's own search with the front matter question `[command] OR [agent]
 *  OR [output-style]`, which reads every note once, on the crate's side in the app and in
 *  a worker in a browser, and then only the notes that answered are read here. Kept per
 *  space until the link index says a note changed, so the menu is a lookup and a command
 *  written on another device is there once it has synced. Nothing outside the space is
 *  read: nib never opens `~/.claude` or `~/.codex`.
 *
 *  A note in a space somebody else can reach is offered too, but a collaborator may
 *  have written it, so its words are theirs: the same rule that keeps their raw HTML as
 *  characters (trust.ts), asked with `fromOthers` each time the note is used rather than
 *  kept here, since who can reach a space is known only once the account has listed it.
 *  The commands then let such a note ask for no more than the thread already has (see
 *  `noMoreThan` in modes.ts), and its words reach the model marked as from outside. */

import { links } from '../../link-index.svelte'
import type { Query } from '../../search/query'
import { workspace } from '../../workspace.svelte'
import { untrusted } from '../chat/transcript'
import { NOTE_KEYS, type NoteCommand, type NoteKind, rolesOf } from './notes'

/** The most notes of each kind worth a menu row. */
const MOST = 500

const ASKED: Query = {
  kind: 'any',
  of: NOTE_KEYS.map((name) => ({ kind: 'property', name, value: null, compare: 'has' })),
}

const held = new Map<string, { version: number; found: NoteCommand[] }>()
const asking = new Map<string, Promise<NoteCommand[]>>()

async function ask(root: string, version: number): Promise<NoteCommand[]> {
  const { searchSpace } = await import('../../search/space')
  const paths = new Set<string>()
  await searchSpace(
    root,
    ASKED,
    [],
    MOST,
    (batch) => {
      for (const hit of batch.hits) if (hit.page === undefined && !hit.tab) paths.add(hit.path)
    },
    workspace.leftOutOf(root),
  )
  const read = await Promise.all(
    [...paths].map(async (path) => {
      const text = await workspace.noteText(path).catch(() => null)
      return text ? rolesOf(path, text) : []
    }),
  )
  const found = read.flat().sort((a, b) => a.name.localeCompare(b.name))
  held.set(root, { version, found })
  return found
}

/** What a space holds (the one in front, unless another is named), as last found; a
 *  search is started when that is out of date, and its answer is what the next call
 *  returns. */
export function foundNow(root = workspace.activeSpace?.root): NoteCommand[] {
  if (!root) return []
  const version = links.version
  const kept = held.get(root)
  if (kept?.version !== version && !asking.has(root)) {
    asking.set(
      root,
      ask(root, version)
        .catch(() => [])
        .finally(() => asking.delete(root)),
    )
  }
  return kept?.found ?? []
}

/** The same, waited for: for a command typed whole before the menu was ever opened. */
export async function found(root = workspace.activeSpace?.root): Promise<NoteCommand[]> {
  foundNow(root)
  if (root) await asking.get(root)
  return foundNow(root)
}

/** One kind, by name, in the space named or the one in front. */
export async function foundNamed(
  kind: NoteKind,
  name: string,
  root?: string,
): Promise<NoteCommand | null> {
  const wanted = name.trim().toLowerCase()
  return (await found(root)).find((one) => one.kind === kind && one.name === wanted) ?? null
}

/** The root of a thread's own space, or null where it is not on this device. */
export function rootOfSpace(space: string): string | null {
  return workspace.spaces.find((one) => one.id === space)?.root ?? null
}

/** Whether somebody else may have written the note at `path`: asked of the sharing
 *  rule each time, so an answer from before the account listed its spaces is not
 *  kept. Fetched when asked, as the search is. */
export async function fromOthers(path: string): Promise<boolean> {
  const { reachedByOthers } = await import('../../sharing.svelte')
  return reachedByOthers(path)
}

/** A note's body as the model is to get it: as is from a space only the reader is
 *  in, inside the untrusted mark from one somebody else can reach (docs/agent-native.md
 *  9.6). */
export async function wordsOf(note: NoteCommand | null | undefined): Promise<string> {
  if (!note?.body) return ''
  if (!(await fromOthers(note.path))) return note.body
  return untrusted(note.path, note.body)
}
