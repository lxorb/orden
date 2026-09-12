/** A PDF, read as pages to write on.
 *
 *  Two files out of one. The paper goes into the space exactly as it arrived - byte
 *  for byte, so Obsidian, a browser and every other reader open it - and beside it
 *  goes a page note whose pages are that paper's pages. Nothing of the PDF is baked
 *  into the note: each page says which file and which page of it, and the picture is
 *  drawn from the paper when somebody looks at it. See pages/paper.ts.
 *
 *  Which is why this is an import and not a conversion. A conversion would turn a
 *  paper into pictures and leave somebody with a folder of PNGs where their paper
 *  used to be; this puts the paper in the space and gives them somewhere to write on
 *  it. The two files travel together, and the note names the paper by a relative path
 *  so moving the pair keeps the link.
 *
 *  The page sizes are read out of the PDF and nothing is drawn: a page's size is in
 *  its own dictionary, so a book of four hundred pages is a read of the file rather
 *  than four hundred renders. That is what lets the sheet say what it is about to
 *  make before it makes it. */

import { writeCanvas } from '@nib/markdown/canvas'
import { pagesFromPdf } from '@nib/markdown/pages'
import { pdfjs } from '../pdf/document'
import { PDF_TO_CSS } from '../pdf/pages'
import type { ImportPlan, Lost, Planned } from './plan'
import type { Source } from './sources'

/** What a paper's page note is called: the paper's own name with `.pages` after the
 *  stem, so `Lecture 4.pdf` is written on in `Lecture 4.pages` and the pair reads as
 *  a pair in the file list. */
function pagesNameFor(path: string): string {
  const name = path.split('/').pop() ?? path
  return `${name.replace(/\.pdf$/i, '')}.pages`
}

/** The plan: every paper, and a page note beside each. */
export async function readPdfPages(sources: readonly Source[]): Promise<ImportPlan> {
  const files: Planned[] = []
  const lost: Lost[] = []

  for (const source of sources) {
    const bytes = await source.bytes()
    const name = source.path.split('/').pop() ?? source.path

    files.push({ kind: 'file', path: name, bytes })

    const sizes = await sizesOf(bytes).catch(() => [])
    if (!sizes.length) {
      lost.push({
        text: '{name} could not be read as a PDF, so it arrived as the file only.',
        values: { name },
      })
      continue
    }

    // The note names the paper by name alone, because the two land in the same
    // folder: a relative path is what a JSON Canvas file node holds and what
    // Obsidian follows.
    files.push({
      kind: 'note',
      path: pagesNameFor(name),
      text: writeCanvas(pagesFromPdf(name, sizes)),
    })
  }

  return { format: 'pdf-pages', files, lost }
}

/** Every page's size, out of bytes rather than out of a path: an import holds the
 *  file in memory and has not written it anywhere yet, which is the whole point of
 *  showing what it would make first.
 *
 *  The same read `pdfPageSizes` in pages/paper.ts does of a file on disk: one answer
 *  to "how big is each page", asked of whichever of the two is in hand. */
async function sizesOf(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const library = await pdfjs()
  // A copy, because the worker takes the bytes and the import still needs them to
  // write the file with.
  const task = library.getDocument({ data: bytes.slice() })

  try {
    const doc = await task.promise
    const sizes: { width: number; height: number }[] = []

    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number)
      const view = page.getViewport({ scale: PDF_TO_CSS })
      sizes.push({ width: Math.round(view.width), height: Math.round(view.height) })
      page.cleanup()
    }

    return sizes
  } finally {
    await task.destroy().catch(() => undefined)
  }
}
