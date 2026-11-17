// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { pastedMarkdown } from './paste'

const CONFLUENCE_TABLE =
  '<meta charset="utf-8"><div class="table-wrap"><table class="wrapped confluenceTable"><colgroup><col /><col /></colgroup><tbody><tr><th class="confluenceTh">Service</th><th class="confluenceTh">Owner</th></tr><tr><td class="confluenceTd"><a href="https://wiki.example.com/display/API">API</a></td><td class="confluenceTd">Ana</td></tr></tbody></table></div>'

const CONFLUENCE_TEXT = 'Service\tOwner\nAPI\tAna'

const WIKIPEDIA_TABLE =
  '<meta charset="utf-8"><table class="wikitable"><caption>Moons of the inner planets</caption><tbody><tr><th>Planet</th><th>Moons</th></tr><tr><td><a href="https://en.wikipedia.org/wiki/Mars">Mars</a></td><td>2</td></tr></tbody></table>'

const WIKIPEDIA_TEXT = 'Moons of the inner planets\nPlanet\tMoons\nMars\t2'

describe('a web table whose header cells follow its column widths or caption', () => {
  test('from Confluence keeps its header cells as the header row', async () => {
    const drawn = renderMarkdown((await pastedMarkdown(CONFLUENCE_TABLE, CONFLUENCE_TEXT)) ?? '')
    expect(drawn).toContain('<th>Service</th>')
    expect(drawn).not.toContain('<td>Service</td>')
  })

  test('from Wikipedia keeps its header cells as the header row', async () => {
    const drawn = renderMarkdown((await pastedMarkdown(WIKIPEDIA_TABLE, WIKIPEDIA_TEXT)) ?? '')
    expect(drawn).toContain('<th>Planet</th>')
    expect(drawn).not.toContain('<td>Planet</td>')
  })

  test('from Wikipedia keeps its caption out of the rows', async () => {
    const drawn = renderMarkdown((await pastedMarkdown(WIKIPEDIA_TABLE, WIKIPEDIA_TEXT)) ?? '')
    expect(drawn).toContain('Moons of the inner planets')
    expect(drawn).not.toContain('<td>Moons of the inner planets</td>')
  })
})
