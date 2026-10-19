/** A PDF, read as pages to write on.
 *
 *  One thing out of one: a page note named after the paper, whose pages are that
 *  paper's pages, holding the paper itself - byte for byte, so Obsidian, a browser and
 *  every other reader still open it. The plan is the paper, marked to become its page
 *  note the moment it has landed, which is the one way any PDF becomes one; see
 *  pages/from-pdf.ts. So an import, a drop and a PDF opened with nib all make the same
 *  page note, and a name that is taken steps aside the same way.
 *
 *  Nothing of the PDF is baked into the note: each page says which file and which
 *  page of it, and the picture is drawn from the paper when somebody looks at it. See
 *  pages/paper.ts.
 *
 *  The paper is read here as well, for its pages and nothing drawn, so a file that is
 *  not a PDF at all is said to be one now, before anything is written. */

import { pageSizes } from '../pdf/document'
import { isJunk, Names, safeParts } from './names'
import type { ImportPlan, Lost, Planned } from './plan'
import type { Source } from './sources'

/** The plan: every paper, each to become its page note. */
export async function readPdfPages(sources: readonly Source[]): Promise<ImportPlan> {
  const files: Planned[] = []
  const lost: Lost[] = []
  const names = new Names()

  for (const source of sources) {
    // The `._` twin a Mac zips up beside every paper is not one, nor is a folder's
    // `.DS_Store`; see looksLikePapers, which already looked past them.
    if (isJunk(source.path)) continue

    const bytes = await source.bytes()
    // Papers land side by side, whatever folders they came out of, under a name a
    // file may have everywhere: `Q&A: week 1?.pdf` is written on Windows too, and two
    // papers called `Notes.pdf` are two papers.
    const name = names.free(safeParts(source.path.split('/').pop() ?? source.path))

    const sizes = await pageSizes(bytes).catch(() => [])
    if (sizes.length) {
      files.push({ kind: 'file', path: name, bytes, pages: true })
      continue
    }

    files.push({ kind: 'file', path: name, bytes })
    lost.push({
      text: '{name} could not be read as a PDF, so it arrived as the file only.',
      values: { name },
    })
  }

  return { format: 'pdf-pages', files, lost }
}
