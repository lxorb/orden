const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

export function escape(text: string): string {
  return text.replace(/[&<>"]/g, (character) => ESCAPES[character] ?? character)
}

export interface Head {
  title: string
  site: string
  url: string
  description?: string | undefined
  image?: string | undefined
  author?: string | null | undefined
  article?: boolean
  date?: string | undefined
  feed?: boolean
  icon?: boolean
  noindex?: boolean
  sheets?: readonly string[]
  style?: string
}

function tag(name: string, content: string | undefined): string {
  return content ? `<meta name="${name}" content="${escape(content)}">` : ''
}

function property(name: string, content: string | undefined): string {
  return content ? `<meta property="${name}" content="${escape(content)}">` : ''
}

export function headOf(head: Head, sheets: readonly string[]): string {
  const description = head.description
  const canonical = head.url

  return [
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escape(head.title)}</title>`,
    tag('description', description),
    tag('author', head.author ?? undefined),
    head.noindex ? tag('robots', 'noindex, nofollow') : '',
    `<link rel="canonical" href="${escape(canonical)}">`,
    property('og:type', head.article ? 'article' : 'website'),
    property('og:title', head.title),
    property('og:description', description),
    property('og:url', canonical),
    property('og:site_name', head.site),
    property('og:image', head.image),
    head.article && head.date ? property('article:published_time', head.date) : '',
    tag('twitter:card', head.image ? 'summary_large_image' : 'summary'),
    tag('twitter:title', head.title),
    tag('twitter:description', description),
    tag('twitter:image', head.image),
    head.feed
      ? `<link rel="alternate" type="application/atom+xml" title="${escape(head.site)}" href="/feed.xml">
<link rel="alternate" type="application/rss+xml" title="${escape(head.site)}" href="/rss.xml">`
      : '',
    head.icon
      ? '<link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="apple-touch-icon" href="/favicon.svg">'
      : '',
    ...sheets.map((href) => `<link rel="stylesheet" href="${escape(href)}">`),
    head.style ? `<style>${head.style}</style>` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
