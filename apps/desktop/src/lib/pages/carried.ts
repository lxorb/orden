/** The paper a page note holds, carried with the note (#551).
 *
 *  A page note made from a PDF is the PDF with ink on it: `Lecture.pages` here, and
 *  its paper `Lecture.pages.pdf` beside it (held.ts). On the account the two are one
 *  thing, kept by the note's id - the note's row names the hash of its paper, and the
 *  bytes are a blob like any other - rather than two files paired by name. So the paper
 *  reaches whoever reaches the note: the account's other devices on either sync, and
 *  somebody the note was shared with on its own, who has no space to find a file in.
 *  A rename, a move and Recently deleted take it along, because nothing about the
 *  paper on the account is a name.
 *
 *  Two halves. After a pass, every page note the account knows is carried: its paper
 *  goes up the first time, and comes down where this device has none - which is also
 *  what sends up the paper of a page note made before any of this existed. And a page
 *  that opens before that has happened asks for the paper itself (`paperFor`), so
 *  nobody waits for a pass to see what they opened.
 *
 *  The paper is taken to be the paper for good once carried: nothing in the app writes
 *  a held paper over, so the bytes are read and hashed once per note, not once per
 *  pass.
 *
 *  A paper that does not go up is not sent again on every pass, since each send is the
 *  whole PDF read, hashed and sent. One the account refuses for what it is - a PDF over
 *  the account's limit - waits for the file to change, and the Sync pane's log says so
 *  once. Anything else may pass by itself, and is tried again later and later. Memory
 *  only, as a refused note's is (`refusalRows` in sync2/pass.ts): a launch asks again. */

import { readCanvas } from '@orden/markdown/canvas'
import { pagesOf } from '@orden/markdown/pages'
import { ApiError } from '../api'
import { paperRetryDelay } from '../backoff'
import { nameOf } from '../space-paths'
import { paperOf } from './held'

/** A page note the account holds: where it is here, and its id there. */
export interface Carried {
  path: string
  id: string
  /** Whether this device may say what the note holds: false in a space shared to
   *  read, where the paper only comes down. */
  writes: boolean
  /** The space it is in, as the log of the sync carrying it names a space. */
  space: string
}

/** What carrying needs of the app and the account. */
export interface Carrying {
  /** Whether a file is on this disk. */
  exists(path: string): Promise<boolean>
  /** What says a file changed without reading it, or null where nothing can say. */
  stamp(path: string): Promise<string | null>
  read(path: string): Promise<Uint8Array | null>
  write(path: string, bytes: Uint8Array): Promise<void>
  /** A note's words, to see whether its pages name a paper at all. */
  text(path: string): Promise<string | null>
  hash(bytes: Uint8Array): Promise<string>
  /** The bytes up under their hash, and the note named as holding them. */
  up(id: string, hash: string, bytes: Uint8Array): Promise<void>
  /** The paper the account has for a note, or null where it has none. */
  down(id: string): Promise<Uint8Array | null>
  /** The hash each note's paper was last carried as, by the note's id. */
  carried: Map<string, string>
  /** Said after `carried` changes, so it can be kept. */
  kept(): void
  /** A line for the Sync pane's log, about one note. */
  said(note: Carried, failed: string): void
}

/** Page notes whose paper the account was asked for and did not have, by when: asked
 *  again only a while later, since the device that made the note may not have carried
 *  it up yet, and asking every pass would be a request per note per pass for nothing. */
const lacking = new Map<string, number>()

/** How long a paper the account did not have is left before it is asked for again. */
const ASK_AGAIN = 60_000

/** Page notes found to need nothing this session: their paper carried already, or their
 *  pages drawn on blank sheets. Each note is looked at once a session, not once a pass. */
const settled = new Set<string>()

/** Papers the account refused for what they are, by note id: the stamp the file had. */
const refused = new Map<string, string | null>()

/** Page notes whose carrying failed in a way that may pass, by note id: how many times
 *  in a row, when the next try is, and whether the log has said so. */
const failing = new Map<string, { tries: number; until: number; said: boolean }>()

/** What the account says of the bytes themselves, which saying again changes nothing
 *  about: too big, not a kind it keeps, not what it was told. A full account (507), a
 *  role (403), a note not there (404) and a rate (429) can change with the file as it is,
 *  so they are not among them. */
const REFUSALS: ReadonlySet<number> = new Set([400, 413, 415])

/** Every page note's paper carried: up where the account does not have it from this
 *  device yet, down where this device has none. One note that fails is passed over and
 *  tried again later; the rest still go. */
export async function carryPapers(notes: readonly Carried[], how: Carrying): Promise<void> {
  for (const note of notes) {
    if (Date.now() < (failing.get(note.id)?.until ?? 0)) continue
    try {
      await carryOne(note, how)
      failing.delete(note.id)
    } catch (error) {
      // Out of reach, or refused for now: tried again later.
      const one = failing.get(note.id) ?? { tries: 0, until: 0, said: false }
      one.tries += 1
      one.until = Date.now() + paperRetryDelay(one.tries)
      failing.set(note.id, one)
      if (error instanceof ApiError && error.status === 507 && !one.said) {
        one.said = true
        how.said(note, `no room on the account for ${nameOf(paperOf(note.path))}`)
      }
    }
  }
}

async function carryOne(note: Carried, how: Carrying): Promise<void> {
  const key = `${note.id}\n${note.path}`
  if (settled.has(key) || Date.now() - (lacking.get(note.id) ?? -ASK_AGAIN) < ASK_AGAIN) return
  const paper = paperOf(note.path)

  if (await how.exists(paper)) {
    if (!how.carried.has(note.id) && note.writes) {
      const stamp = await how.stamp(paper)
      if (refused.has(note.id) && refused.get(note.id) === stamp) return
      const bytes = await how.read(paper)
      if (!bytes?.byteLength) return
      const hash = await how.hash(bytes)
      try {
        await how.up(note.id, hash, bytes)
      } catch (error) {
        if (!(error instanceof ApiError && REFUSALS.has(error.status))) throw error
        refused.set(note.id, stamp)
        how.said(note, `the account would not take ${nameOf(paper)}`)
        return
      }
      refused.delete(note.id)
      how.carried.set(note.id, hash)
      how.kept()
    }
    settled.add(key)
    return
  }

  if (!namesAPaper(await how.text(note.path))) {
    settled.add(key)
    return
  }
  const bytes = await how.down(note.id)
  if (!bytes) {
    lacking.set(note.id, Date.now())
    return
  }
  // Carrying runs beside the next pass, and the note may have been renamed, moved or
  // deleted while its paper came down. Written at the old name it would be beside no
  // note, a PDF of its own that sync sends everywhere; the note's new path is carried
  // on its own, and fetches its paper there.
  if (!(await stillWanted(note.path, paper, how))) return
  await how.write(paper, bytes)
  how.carried.set(note.id, await how.hash(bytes))
  how.kept()
  settled.add(key)
}

/** Whether a paper that came down still belongs where it was going: the note still at
 *  its path, and no paper there yet, since one that arrived meanwhile is the note's. */
async function stillWanted(
  note: string,
  paper: string,
  how: Pick<Carrying, 'exists'>,
): Promise<boolean> {
  return (await how.exists(note)) && !(await how.exists(paper))
}

/** Whether a page note's pages are drawn on a paper: a note of blank sheets holds none,
 *  and is never asked about. */
export function namesAPaper(text: string | null): boolean {
  if (!text) return false
  try {
    return pagesOf(readCanvas(text)).some((page) => !!page.file)
  } catch {
    return false
  }
}

/** The pages of a paper this device does not have, from the account: what a page that
 *  opens asks for before any pass has brought the paper down. Written beside the note
 *  where there is one, so it is there from now on; held in memory only for a note
 *  shared on its own, which has no file on this device. Null where the account has no
 *  paper for the note, or cannot be reached. */
export async function paperFor(
  id: string,
  note: string | null,
  how: Pick<Carrying, 'exists' | 'down' | 'write' | 'hash' | 'carried' | 'kept'>,
): Promise<Uint8Array | null> {
  const bytes = await how.down(id).catch(() => null)
  if (!bytes) return null
  // Shown either way; written only where the note still is (`carryOne`).
  if (note && (await stillWanted(note, paperOf(note), how))) {
    await how.write(paperOf(note), bytes)
    how.carried.set(id, await how.hash(bytes))
    how.kept()
  }
  return bytes
}

/** Forgets what the account was found not to have: a paper may have been carried up
 *  from another device since. For the tests, and for a fresh sign-in. */
export function forgetLacking(): void {
  lacking.clear()
  settled.clear()
  refused.clear()
  failing.clear()
}
