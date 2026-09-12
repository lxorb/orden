/** A website as a file in the space.
 *
 *  It is a note: a `.md` file whose front matter says `url:`. Not a `.web` file of
 *  its own, and the reason is Obsidian. A vault shows the extensions it knows and
 *  hides the rest unless somebody has turned "Detect all file extensions" on, so a
 *  `.web` file would be invisible there, unopenable, outside its search and absent
 *  from its graph - a document in nib's space that is not a document in the same
 *  vault read next door. A note with a line of front matter is a note in both: it
 *  shows in the list, `[[Svelte docs]]` resolves to it without an extension in the
 *  link, its title and its address are words in a file and so are found by anybody's
 *  search, and the sync carries it because it carries every note.
 *
 *  What makes it a web tab rather than prose is the one line, read through the link
 *  index - the same pass that already reads `icon:` and `aliases:` off every note,
 *  so no list pays for a second reading. See file-mark.ts for the mark it wears and
 *  workspace.openEntry for what a click on it does.
 *
 *  Three keys, always the three: where it points, what it calls itself, and when it
 *  was written down. The body says the address again as a link, so the file is worth
 *  opening in an app that knows nothing about web tabs - which is exactly what
 *  Obsidian is.
 *
 *  A clip is the other file a web tab writes, and it is here for the same reason: it
 *  is a note this app composes out of a page, front matter first. That one is an
 *  ordinary note with the page's words in it - `source:` rather than `url:` - because
 *  a clip is the words as they were, not a window on the site. See clip.ts. */

import { frontMatterValue, oneLine, writeFrontMatter } from '@nib/markdown/front-matter'
import { isWebAddress } from './address'

/** The key that makes a note a website. */
const URL_KEY = 'url'

/** The file a web tab keeps itself as.
 *
 *  The title is the heading as well as the front matter, because the heading is
 *  what names the file: `workspace.noteFrom` reads it off the top the way it does
 *  for every other note it writes, so a page called "Svelte docs" lands in
 *  `Svelte docs.md` without this having to know anything about paths. */
export function webNote(url: string, title: string, when: Date): string {
  const named = title.trim() || url

  const block = writeFrontMatter([
    [URL_KEY, url],
    ['title', named],
    ['date', when.toISOString()],
  ])

  return `${block}\n\n# ${named}\n\n<${url}>\n`
}

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

  return `${block}\n\n# ${title}\n\n${words || `<${page.url}>`}\n`
}
