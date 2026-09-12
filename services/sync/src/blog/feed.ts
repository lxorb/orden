/** The three files a site is read by something other than a person.
 *
 *  A sitemap so a search engine knows what is there without guessing at paths;
 *  a feed so a reader can follow the writing without coming back to look; a
 *  robots.txt that says what is true, which for a site behind a password is
 *  "none of this".
 *
 *  All three are the same list the index is drawn from, in a different shape, so
 *  nothing here decides what is published; see spaces/site.ts. They are built
 *  per request and cached for an hour: a blog that is written in twice a week
 *  does not need a build step, and a feed reader that asks every hour gets the
 *  hour's answer.
 *
 *  Atom rather than RSS, and one feed rather than both. Atom says what a date
 *  means and what a summary is made of; RSS leaves both to the reader, and every
 *  reader that reads RSS reads Atom. */

import { escape } from './head'

/** One published page, as the machines want it. */
export interface FeedPage {
  /** Where it lives, absolute. */
  url: string
  title: string
  /** When the note was last written, as a moment. */
  updated: number
  /** What the note's own `date:` says, where it says one: the day the writing
   *  is about rather than the day a typo was fixed. */
  date?: string | undefined
  summary?: string | undefined
}

/** How many entries a feed carries. What a reader coming back after a month
 *  wants to see, and not a whole blog in one document. */
const MOST_ENTRIES = 30

function xml(body: string, kind: string): Response {
  return new Response(body, {
    headers: {
      'content-type': `${kind}; charset=utf-8`,
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  })
}

function moment(page: FeedPage): number {
  const said = page.date ? Date.parse(page.date) : Number.NaN
  return Number.isFinite(said) ? said : page.updated
}

/** Newest first, by what the note says its date is and otherwise by when it was
 *  written. A blog is read from the top. */
export function newestFirst(pages: readonly FeedPage[]): FeedPage[] {
  return [...pages].sort((one, other) => moment(other) - moment(one))
}

/** Every page, for a search engine. No priorities and no change frequencies:
 *  both are guesses that no search engine has read since 2015, and a wrong one
 *  is worse than none. */
export function sitemap(pages: readonly FeedPage[]): Response {
  const entries = pages
    .map(
      (page) =>
        `<url><loc>${escape(page.url)}</loc><lastmod>${new Date(moment(page)).toISOString()}</lastmod></url>`,
    )
    .join('')

  return xml(
    `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`,
    'application/xml',
  )
}

/** The writing, newest first, with as much of each page as a reader needs to
 *  decide whether to open it: the description the note gave, or its first words.
 *  Never the whole note - a feed is a table of contents, and a page that is
 *  read in a feed reader is a page nobody visits. */
export function feed(
  pages: readonly FeedPage[],
  site: { title: string; url: string; author: string | null },
): Response {
  const ordered = newestFirst(pages).slice(0, MOST_ENTRIES)
  const updated = new Date(ordered.length ? moment(ordered[0]!) : Date.now()).toISOString()

  const entries = ordered
    .map(
      (page) => `<entry>
<title>${escape(page.title)}</title>
<link href="${escape(page.url)}"/>
<id>${escape(page.url)}</id>
<updated>${new Date(moment(page)).toISOString()}</updated>
${page.summary ? `<summary>${escape(page.summary)}</summary>` : ''}
</entry>`,
    )
    .join('')

  return xml(
    `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>${escape(site.title)}</title>
<link href="${escape(site.url)}"/>
<link rel="self" href="${escape(`${site.url}/feed.xml`)}"/>
<id>${escape(`${site.url}/`)}</id>
<updated>${updated}</updated>
${site.author ? `<author><name>${escape(site.author)}</name></author>` : ''}${entries}
</feed>`,
    'application/atom+xml',
  )
}

/** What a crawler may do here. A site behind a password says no to everything,
 *  because everything it would be shown is the password form. */
export function robots(origin: string, locked: boolean): Response {
  const body = locked
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  })
}
