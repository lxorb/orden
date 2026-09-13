/** The two notes a web tab has anything to do with.
 *
 *  **A clip**, which is a note this app composes out of a page: the page's words,
 *  under front matter that says `source:` and `date:`, exactly as the clipper
 *  extension writes one. A clip is the words as they were rather than a window on the
 *  site, so it is a note and always will be. See clip.ts.
 *
 *  **A website, as it used to be written**: a `.md` file whose front matter said
 *  `url:`. A website is a shortcut file now - `Svelte docs.url`, which is the format
 *  Explorer and every browser already write; see shortcut.ts, which says why. What
 *  is left here is the reading half, because spaces are full of the old ones: a note
 *  that says `url:` is converted the first time anybody opens it, and the three
 *  functions below are what the conversion reads it with.
 *
 *  They go when the last space has been converted, which is not a day this code can
 *  know about. Until then they cost one front-matter read on a pass that was reading
 *  the file anyway. */

import {
  frontMatterEdit,
  frontMatterValue,
  oneLine,
  stripFrontMatter,
  writeFrontMatter,
} from '@nib/markdown/front-matter'
import { asWords } from '@nib/markdown/words'
import { isWebAddress } from './address'

/** The key that made a note a website. */
const URL_KEY = 'url'

/** The address a note points at, or null for a note that is prose.
 *
 *  Judged and not only read: a note whose `url:` says `javascript:...` - because
 *  somebody wrote it by hand, or because it arrived in a shared space - is a note
 *  and not a web tab. The one reading of the key, so the mark in the file list, the
 *  click that opens it and the tab that draws it cannot disagree. */
export function webUrlOf(text: string | null | undefined): string | null {
  const said = frontMatterValue(text ?? '', URL_KEY)
  return said !== null && isWebAddress(said) ? said : null
}

/** What the note says it is called, or null when it says nothing. The page's own
 *  title is better than a file name, and it is what the tab shows before the page
 *  has loaded. */
export function webTitleOf(text: string | null | undefined): string | null {
  const said = frontMatterValue(text ?? '', 'title')?.trim()
  return said === undefined || said.length === 0 ? null : said
}

/** What a note that was a website had to say beyond being one, or null when it had
 *  nothing to say at all.
 *
 *  What the old format wrote under the front matter is a heading and the address as
 *  a link, and a file holding only those two is the shortcut beside it said twice.
 *  Anything else in it is somebody's writing, and that stays a note - with `url:`
 *  taken out, because the shortcut written beside it is what that line now means.
 *
 *  Used once, by the conversion; see `workspace.asShortcut`. */
export function keptBody(text: string): string | null {
  const written = stripFrontMatter(text)
    .split('\n')
    .filter((line) => {
      const said = line.trim()
      // A heading, the address as an autolink, and the blank lines between them:
      // the whole of what the old writer put in the body.
      return said.length > 0 && !said.startsWith('#') && !/^<https?:\/\/[^>]*>$/i.test(said)
    })

  if (written.length === 0) return null

  const edit = frontMatterEdit(text, URL_KEY, null)
  return edit === null ? text : text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
}

/** The longest a page may name itself. A title is a line above an article, and a
 *  page handing over a paragraph is handing over content in the wrong field. The
 *  clipper's own number, for the same reason. */
const LONGEST_TITLE = 300

/** What a clip is called when the page offered no title. The name a new note gets,
 *  and deliberately not translated: a file name is a path, and a path that changes
 *  with the language stops matching itself. */
const UNTITLED = 'Untitled'

/** A page as a note: where it came from, when, and what it said.
 *
 *  `source` and `date`, which is what the clipper writes, so a folder of clips reads
 *  the same whichever of the two saved it. The title is settled once here, so the
 *  front matter, the heading and the file's own name are the same words - the name
 *  comes off the heading; see `workspace.noteFrom`.
 *
 *  A page with no words to keep says the one thing it knows, as a link somebody can
 *  follow.
 *
 *  Answered rather than returned, because turning a page's HTML into markdown means
 *  fetching the converter: turndown and the GFM rules over it are thirty kilobytes
 *  that a window opening on a note has no use for, and the three functions above are
 *  read by the file list on every launch while this one is read by a web tab. Clipping
 *  is already a wait - the page has to be asked for its words first - so the fetch
 *  costs the reader nothing. See clip.ts, the only caller. */
export async function clipNote(
  page: { url: string; title: string; html: string },
  when: Date,
): Promise<string> {
  const title = oneLine(page.title).slice(0, LONGEST_TITLE).trim() || UNTITLED
  const { htmlToMarkdown } = await import('@nib/markdown/from-html')
  const words = page.html.trim() ? htmlToMarkdown(page.html).trim() : ''

  const block = writeFrontMatter([
    ['source', page.url],
    ['title', title],
    ['date', when.toISOString()],
  ])

  // The heading is the page's own words, and a page names itself: the front matter
  // quotes what it holds, but a heading is markdown and a note's markup is markup.
  // See `asWords`, which is what the converter escapes a page's prose with.
  return `${block}\n\n# ${asWords(title)}\n\n${words || `<${page.url}>`}\n`
}
