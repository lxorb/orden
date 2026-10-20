/** A PDF, turned into the page note that holds it.
 *
 *  A PDF in a space is a page note, not a PDF with a page note beside it. Every road
 *  a PDF comes in by - the Import door, a drop onto the file list, a PDF another
 *  program opened with nib - ends here as soon as the file has landed, and a PDF that
 *  was already in the space ends here the first time it is opened. What comes out is
 *  one thing in the file list: `Lecture 4.pages`, in the folder the PDF was in and
 *  under its name, every page of it a page of the paper, with the paper's bytes moved
 *  - not copied - to `Lecture 4.pages.pdf`, the paper the note holds (held.ts).
 *
 *  Moved through the rename every file operation is, so a link to the PDF, a tab, a
 *  bookmark and its highlights all follow it to where it is now held.
 *
 *  Three cases are not a fresh note:
 *
 *  - **A paper already held.** `Lecture 4.pages.pdf` asked for is its note.
 *  - **A page note an older build made beside the PDF.** Its pages name the PDF and
 *    nothing else, so it is this PDF's note already, ink and all: the PDF moves in
 *    under it and nothing in the note is touched. See `besideIts`.
 *  - **Somebody else's page note of that name.** It is left alone and the new note
 *    steps aside by number, `Lecture 4 2.pages`, the way a new note does.
 *
 *  Pure but for what `Turning` does, so every case is a line of from-pdf.test.ts. */

import { readCanvas, writeCanvas } from '@nib/markdown/canvas'
import { pagesFromPdf, pagesOf } from '@nib/markdown/pages'
import { folderOf, nameOf, placesOf, samePath } from '../space-paths'
import { joinPath } from '../tauri'
import { holderOf, paperOf } from './held'

/** What turning a PDF needs of the app. */
export interface Turning {
  /** The root of the space the PDF is in, which a page's paper may be named from. */
  root: string | null
  /** Whether a file is at this path, asked of the disk rather than of the list: the
   *  list does not show a paper that is held. */
  exists(path: string): Promise<boolean>
  read(path: string): Promise<string | null>
  write(path: string, text: string): Promise<void>
  /** The rename every file operation is, so what is kept by path follows. */
  move(from: string, to: string): Promise<void>
  /** A note this made and could not finish, taken away again. */
  discard(path: string): Promise<void>
  /** Each page's size in CSS pixels, read out of the PDF. Throws for a file that is
   *  not one. */
  sizes(path: string): Promise<{ width: number; height: number }[]>
}

/** The page note `pdf` is now, or was already. Throws where the PDF could not be read
 *  or moved, and leaves it where it was. */
export async function asPageNote(pdf: string, how: Turning): Promise<string> {
  // A paper already held is its note's; one whose note has gone is made one again,
  // under the name it already has.
  const holder = holderOf(pdf)
  if (holder && (await how.exists(holder))) return holder

  const wanted = holder ?? pdf.replace(/\.pdf$/i, '.pages')
  if (!holder && (await how.exists(wanted)) && (await movedIn(pdf, wanted, how))) return wanted

  const note = holder ?? (await freeNote(wanted, how))
  const paper = holder ? pdf : paperOf(note)
  await how.write(note, writeCanvas(pagesFromPdf(nameOf(paper), await how.sizes(pdf))))
  if (holder) return note

  try {
    await how.move(pdf, paper)
  } catch (error) {
    // The move may have happened and something after it failed. Then the paper is the
    // note's, the reader's only copy of the PDF, and discarding the note would delete
    // it with it, for good (#537): the note is kept, and the PDF is in it.
    if ((await how.exists(paper)) && !(await how.exists(pdf))) return note
    await how.discard(note).catch(() => undefined)
    throw error
  }
  return note
}

/** A page note an older build made beside its PDF, given the PDF to hold: what
 *  opening one does, so the pair the file list showed becomes the one note it is.
 *  Answers whether `note` was one. */
export async function adoptBeside(note: string, how: Turning): Promise<boolean> {
  const pdf = note.replace(/\.pages$/i, '.pdf')
  return (await how.exists(pdf)) && (await movedIn(pdf, note, how))
}

/** `pdf` moved in under `note`, where the note is the one an older build made for it
 *  and holds no paper yet. Nothing in the note is written: its pages still name the
 *  PDF by its old name, and the paper the note holds is the first place a page's paper
 *  is looked for (`paperPlaces` in held.ts), so the ink stays exactly where it was. */
async function movedIn(pdf: string, note: string, how: Turning): Promise<boolean> {
  if (await how.exists(paperOf(note))) return false

  const text = await how.read(note)
  if (text === null || !besideIts(text, note, pdf, how.root)) return false

  await how.move(pdf, paperOf(note))
  return true
}

/** Whether the page note `text` at `note` is the one an older build made for `pdf`:
 *  every page has a paper, and every paper it names is that PDF. A page note with a
 *  blank sheet in it, or one page from another paper, is somebody's own and is not
 *  taken for it. */
function besideIts(text: string, note: string, pdf: string, root: string | null): boolean {
  let pages
  try {
    pages = pagesOf(readCanvas(text))
  } catch {
    return false
  }

  return (
    pages.length > 0 &&
    pages.every(
      (page) => !!page.file && placesOf(page.file, note, root).some((one) => samePath(one, pdf)),
    )
  )
}

/** How many names `freeNote` tries before it gives up: a folder holding a thousand
 *  page notes of one name is a disk answering every question yes. */
const MOST_TRIED = 1000

/** `wanted`, or the first of `Lecture 4 2.pages`, `Lecture 4 3.pages` and on where
 *  neither the note nor its paper is taken. */
async function freeNote(wanted: string, how: Turning): Promise<string> {
  const folder = folderOf(wanted)
  const stem = nameOf(wanted).replace(/\.pages$/i, '')

  for (let counter = 1; counter <= MOST_TRIED; counter += 1) {
    const name = counter === 1 ? `${stem}.pages` : `${stem} ${String(counter)}.pages`
    const path = folder ? joinPath(folder, name) : name
    if (!(await how.exists(path)) && !(await how.exists(paperOf(path)))) return path
  }
  throw new Error(`no name is free for ${wanted}`)
}
