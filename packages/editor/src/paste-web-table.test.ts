// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { pastedMarkdown } from './paste'

const README_TABLE =
  '<meta charset="utf-8"><table><thead><tr><th>Option</th><th>Meaning</th></tr></thead><tbody><tr><td><code>--force</code></td><td>See <a href="https://example.com/docs/force">the guide</a></td></tr><tr><td><code>__all__</code></td><td><strong>Required</strong></td></tr></tbody></table>'

const README_TEXT = 'Option\tMeaning\n--force\tSee the guide\n__all__\tRequired'

describe('a table copied on its own from a web page', () => {
  test('keeps the links in its cells', async () => {
    const drawn = renderMarkdown((await pastedMarkdown(README_TABLE, README_TEXT)) ?? '')
    expect(drawn).toContain('<a href="https://example.com/docs/force">the guide</a>')
  })

  test('keeps code in its cells as code, so its underscores are not read as bold', async () => {
    const drawn = renderMarkdown((await pastedMarkdown(README_TABLE, README_TEXT)) ?? '')
    expect(drawn).toContain('<code>--force</code>')
    expect(drawn).toContain('<code>__all__</code>')
    expect(drawn).not.toContain('<strong>all</strong>')
  })
})
