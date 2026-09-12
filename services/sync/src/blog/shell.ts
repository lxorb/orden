/** What is on every page of a site besides the note.
 *
 *  A site is a note with furniture around it: a search box and a theme button at
 *  the top, the published pages down the left, the headings of this page down the
 *  right, what links here and where to go next at the foot. All of it is built
 *  from the one list of published pages, and all of it is optional - a site of
 *  one note has none of it, and a reader with scripting off loses only the
 *  niceties.
 *
 *  Kept out of blog.ts because that file is about answering requests and this is
 *  about what a page looks like. Nothing here reads the database or the bucket:
 *  it is given the list and the page, and it writes markup. */

import { tableOfContents, type Heading } from '@nib/markdown'
import { escape } from './head'
import { searchBox } from './find'
import { backlinks, beforeAndAfter, type Listed, navigation } from './nav'
import type { Site } from './site'

/** What the head and the shell need to know about the site as a whole. */
export interface Around {
  /** What the site is called, which is the word at the top left. */
  site: string
  /** Every page it publishes, for the navigation and the backlinks. */
  pages: readonly Listed[]
  /** What the reader typed, where they are on the search page. */
  query?: string
  /** Whether this site has a search index worth showing a box for: a site of one
   *  note is not searched, it is read. */
  searchable: boolean
}

/** The bar at the top: the site's name, the search box, the theme button.
 *
 *  The name is a link home, because a reader three pages in wants one. The theme
 *  button says nothing in words - three states, one glyph each - and it is the
 *  only control on a published page that needs the script; without it the page
 *  follows the reader's system, which is what it did before there was a button. */
export function bar(around: Around): string {
  return `<header class="bar">
<a class="home" href="/">${escape(around.site)}</a>
${around.searchable ? searchBox(around.query ?? '') : ''}
<button class="theme" type="button" aria-label="Theme"></button>
</header>`
}

/** The pages down the left. Empty for a site with one page, or none to speak of:
 *  a column listing the page you are reading is furniture for its own sake. */
export function aside(around: Around, current: string): string {
  return around.pages.length > 1 ? navigation(around.pages, current) : ''
}

/** The headings of this page down the right, and collapsed on a phone.
 *
 *  A `<details>`, because that is a disclosure every browser already knows how to
 *  open and close with no script at all. Closed in the markup, which is what a
 *  phone should show; the stylesheet reveals it and hides the summary where there
 *  is a column to put it in. Two headings are not a table of contents. */
export function contents(headings: readonly Heading[]): string {
  const worth = headings.filter((one) => one.level >= 2 && one.level <= 3)
  if (worth.length < 3) return ''

  return `<details class="toc-aside"><summary>Contents</summary>${tableOfContents([
    ...worth,
  ])}</details>`
}

/** Under the note: what links here, and the pages either side of this one. */
export function underneath(around: Around, page: Listed | null): string {
  if (!page) return ''

  return `${backlinks(around.pages, page)}${beforeAndAfter(around.pages, page.slug)}`
}

/** The site's own scripts and sheets, as the head links them.
 *
 *  `publish.css` and `publish.js` at the root of the space are Obsidian's own
 *  names for "the author's own dressing", and they are served from the site
 *  itself at a path that is the file's own hash. The script is the one thing on a
 *  published page that runs somebody's own code, and it is the author's own page
 *  it runs on; see docs/publishing.md. */
export function ownFiles(byFile: Map<string, string>): { css: string | null; js: string | null } {
  return { css: byFile.get('publish.css') ?? null, js: byFile.get('publish.js') ?? null }
}

/** What an analytics provider is asked to load, where the author named one.
 *
 *  A script from somebody else's domain, which is the whole of what analytics
 *  is, so it is named in the policy and written down in the docs: the reader's
 *  address and what they read leave to that provider. Nothing is injected where
 *  nothing is set, which is every site until an author types something. */
export function counter(site: Site): string {
  const said = site.analytics
  if (!said) return ''

  // One script from the provider's own domain, which is what Plausible, Umami
  // and GoatCounter each are. Nothing inline, so the page's policy names that
  // one origin and nothing else gains a way in.
  return `<script defer src="${escape(said.url)}"${
    said.domain ? ` data-domain="${escape(said.domain)}"` : ''
  }></script>`
}
