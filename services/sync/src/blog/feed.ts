import { escape } from './head'

export interface FeedPage {
  url: string
  title: string
  updated: number
  date?: string | undefined
  summary?: string | undefined
}

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

export function moment(page: FeedPage): number {
  const said = page.date ? Date.parse(page.date) : Number.NaN
  return Number.isFinite(said) ? said : page.updated
}

export function newestFirst(pages: readonly FeedPage[]): FeedPage[] {
  return [...pages].sort((one, other) => moment(other) - moment(one))
}

export function sitemap(pages: readonly FeedPage[]): Response {
  const entries = pages
    .map(
      (page) =>
        `<url><loc>${escape(page.url)}</loc><lastmod>${new Date(page.updated).toISOString()}</lastmod></url>`,
    )
    .join('')

  return xml(
    `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`,
    'application/xml',
  )
}

export interface FeedSite {
  title: string
  url: string
  author: string | null
  description?: string | undefined
}

function entriesOf(pages: readonly FeedPage[]): FeedPage[] {
  return newestFirst(pages).slice(0, MOST_ENTRIES)
}

export function feed(pages: readonly FeedPage[], site: FeedSite): Response {
  const ordered = entriesOf(pages)
  const newest = ordered[0]
  const updated = new Date(newest ? moment(newest) : Date.now()).toISOString()

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

export function rss(pages: readonly FeedPage[], site: FeedSite): Response {
  const ordered = entriesOf(pages)
  const newest = ordered[0]
  const built = new Date(newest ? moment(newest) : Date.now()).toUTCString()

  const items = ordered
    .map(
      (page) => `<item>
<title>${escape(page.title)}</title>
<link>${escape(page.url)}</link>
<guid isPermaLink="true">${escape(page.url)}</guid>
<pubDate>${new Date(moment(page)).toUTCString()}</pubDate>
${page.summary ? `<description>${escape(page.summary)}</description>` : ''}
</item>`,
    )
    .join('')

  return xml(
    `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${escape(site.title)}</title>
<link>${escape(`${site.url}/`)}</link>
<description>${escape(site.description ?? site.title)}</description>
<lastBuildDate>${built}</lastBuildDate>
<atom:link rel="self" type="application/rss+xml" href="${escape(`${site.url}/rss.xml`)}"/>
${site.author ? `<managingEditor>${escape(site.author)}</managingEditor>` : ''}${items}
</channel>
</rss>`,
    'application/rss+xml',
  )
}

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
