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
 *  pass. */

import { readCanvas } from '@nib/markdown/canvas'
import { pagesOf } from '@nib/markdown/pages'
import { paperOf } from './held'

/** A page note the account holds: where it is here, and its id there. */
export interface Carried {
  path: string
  id: string
  /** Whether this device may say what the note holds: false in a space shared to
   *  read, where the paper only comes down. */
  writes: boolean
}

/** What carrying needs of the app and the account. */
export interface Carrying {
  /** Whether a file is on this disk. */
  exists(path: string): Promise<boolean>
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

/** Every page note's paper carried: up where the account does not have it from this
 *  device yet, down where this device has none. One note that fails is passed over and
 *  tried at the next pass; the rest still go. */
export async function carryPapers(notes: readonly Carried[], how: Carrying): Promise<void> {
  for (const note of notes) {
    try {
      await carryOne(note, how)
    } catch {
      // Out of reach, or refused: the next pass tries again.
    }
  }
}

async function carryOne(note: Carried, how: Carrying): Promise<void> {
  const key = `${note.id}\n${note.path}`
  if (settled.has(key) || Date.now() - (lacking.get(note.id) ?? -ASK_AGAIN) < ASK_AGAIN) return
  const paper = paperOf(note.path)

  if (await how.exists(paper)) {
    if (!how.carried.has(note.id) && note.writes) {
      const bytes = await how.read(paper)
      if (!bytes?.byteLength) return
      const hash = await how.hash(bytes)
      await how.up(note.id, hash, bytes)
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
  await how.write(paper, bytes)
  how.carried.set(note.id, await how.hash(bytes))
  how.kept()
  settled.add(key)
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
  how: Pick<Carrying, 'down' | 'write' | 'hash' | 'carried' | 'kept'>,
): Promise<Uint8Array | null> {
  const bytes = await how.down(id).catch(() => null)
  if (!bytes) return null
  if (note) {
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
}
