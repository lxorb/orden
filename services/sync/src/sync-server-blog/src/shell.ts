import { tableOfContents, type Heading } from '@orden/markdown'
import { escape, type Site } from '../../sync-server/src/api'
import { searchBox } from './find'
import { backlinks, beforeAndAfter, type Listed, navigation } from './nav'
export interface Around {
  site: string
  pages: readonly Listed[]
  query?: string
  searchable: boolean
}

export function bar(around: Around): string {
  return `<header class="bar">
<a class="home" href="/">${escape(around.site)}</a>
${around.searchable ? searchBox(around.query ?? '') : ''}
<button class="theme" type="button" aria-label="Theme"></button>
</header>`
}

export function aside(around: Around, current: string): string {
  return around.pages.length > 1 ? navigation(around.pages, current) : ''
}

export function contents(headings: readonly Heading[]): string {
  const worth = headings.filter((one) => one.level >= 2 && one.level <= 3)
  if (worth.length < 3) return ''

  return `<details class="toc-aside"><summary>Contents</summary>${tableOfContents([
    ...worth,
  ])}</details>`
}

export function underneath(around: Around, page: Listed | null): string {
  if (!page) return ''

  return `${backlinks(around.pages, page)}${beforeAndAfter(around.pages, page.slug)}`
}

export function ownFiles(byFile: Map<string, string>): { css: string | null; js: string | null } {
  return { css: byFile.get('publish.css') ?? null, js: byFile.get('publish.js') ?? null }
}

export function counter(site: Site): string {
  const said = site.analytics
  if (!said) return ''

  return `<script defer src="${escape(said.url)}"${
    said.domain ? ` data-domain="${escape(said.domain)}"` : ''
  }></script>`
}
