/** Finding words in a PDF.
 *
 *  The same three steps the reading view takes - read the words once, find the
 *  places in the string, paint each one as a range - so `reading/find.ts` does the
 *  finding and the painting and this only says what a page's words are. One find
 *  bar, one way of counting, one way of showing a match.
 *
 *  What differs is where the words come from. A rendered page's text layer is a
 *  span per run of text, in the order pdf.js read them; a page nobody has scrolled
 *  to has the same runs and no spans at all. So a page is searched from its runs
 *  either way, and only the painting needs the spans. */

import type { Words } from '../reading/find'

/** A page's words, as the runs pdf.js laid out. */
export function textOfRuns(runs: readonly string[]): string {
  return runs.join('')
}

/** A page's words with the node each run of them sits in, ready for `rangeOf`.
 *
 *  `divs` is the text layer's own `textDivs`, which pdf.js keeps index for index
 *  with the runs - including the empty ones, which it makes a span for and never
 *  puts on the page. Those are left out here: they are nothing to paint, and they
 *  add nothing to the words either. */
export function wordsOfRuns(runs: readonly string[], divs: readonly HTMLElement[]): Words {
  const words: Words = { text: textOfRuns(runs), pieces: [] }
  let at = 0

  for (const [index, run] of runs.entries()) {
    const node = divs[index]?.firstChild
    if (run && node instanceof Text) words.pieces.push({ node, at })
    at += run.length
  }

  return words
}
