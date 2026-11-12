import { describe, expect, test } from 'vitest'
import { moment, newestFirst, robots, sitemap } from '../src/feed'
import { asked, hasWords, searchBox } from '../src/find'
import { keptCover } from '../src/kept-cover'

describe('the blog feed', () => {
  const pages = [
    { url: 'https://b.example/old', title: 'Old', updated: 1000 },
    { url: 'https://b.example/dated', title: 'Dated', updated: 500, date: '2026-01-02' },
    { url: 'https://b.example/new', title: 'New', updated: 2000 },
  ]

  test('orders newest first, by the written date when a page has one', () => {
    expect(moment(pages[1]!)).toBe(Date.parse('2026-01-02'))
    expect(moment({ ...pages[1]!, date: 'not a date' })).toBe(500)
    expect(newestFirst(pages).map((page) => page.title)).toEqual(['Dated', 'New', 'Old'])
  })

  test('the sitemap lists every page with its last change, as cacheable xml', async () => {
    const answer = sitemap(pages)
    expect(answer.headers.get('content-type')).toBe('application/xml; charset=utf-8')
    expect(answer.headers.get('cache-control')).toBe('public, max-age=3600')
    const body = await answer.text()
    for (const page of pages) expect(body).toContain(`<loc>${page.url}</loc>`)
    expect(body).toContain(new Date(2000).toISOString())
  })

  test('robots keep crawlers out of a locked site and point an open one at its sitemap', async () => {
    expect(await robots('https://b.example', true).text()).toMatch(/Disallow: \//)
    const open = await robots('https://b.example', false).text()
    expect(open).toContain('https://b.example/sitemap.xml')
  })
})

describe('searching a blog', () => {
  test('reads words, phrases, exclusions, tags and folders from a query', () => {
    const query = asked('plan "next quarter" -draft tag:#Work path:Notes')
    expect(query).toEqual({
      words: ['plan'],
      phrases: ['next quarter'],
      without: ['draft'],
      tags: ['work'],
      folders: ['notes'],
    })
    expect(hasWords(query)).toBe(true)
    expect(hasWords(asked('tag:work'))).toBe(false)
  })

  test('the search box echoes the query escaped', () => {
    expect(searchBox('<b>')).toContain('&lt;b&gt;')
    expect(searchBox('<b>')).not.toContain('<b>')
  })
})

describe('covers', () => {
  test('reads a cover from kept metadata and ignores one without a source', () => {
    expect(keptCover(null)).toBeNull()
    expect(keptCover('{}')).toBeNull()
    expect(keptCover(JSON.stringify({ cover: 'https://b.example/c.png' }))).toMatchObject({
      src: 'https://b.example/c.png',
    })
  })
})
