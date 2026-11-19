import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'

const CALLOUT_PERCENT = '> [!note] Trip\n> Pack the bags\n> %%\n> old plan\n> %%\n> Book the hotel\n\nafter'
const CALLOUT_HTML = '> [!note] Trip\n> Pack the bags\n> <!--\n> old plan\n> -->\n> Book the hotel\n\nafter'
const QUOTE_PERCENT = '> Pack the bags\n> %%\n> old plan\n> %%\n> Book the hotel'
function bodyOf(html: string): string {
  const at = html.indexOf('callout-body')
  return at < 0 ? '' : html.slice(at)
}
describe('lines commented out inside a callout or a quote in the reading view', () => {
  test('a %% comment keeps the words after it inside the callout', () => {
    const html = renderMarkdown(CALLOUT_PERCENT)
    expect(html).not.toContain('old plan')
    expect(html.match(/<blockquote/g) ?? []).toHaveLength(0)
    expect(bodyOf(html).split('</div>')[0]).toContain('Book the hotel')
  })
  test('an HTML comment keeps the words after it inside the callout', () => {
    const html = renderMarkdown(CALLOUT_HTML)
    expect(html.match(/<blockquote/g) ?? []).toHaveLength(0)
    expect(bodyOf(html).split('</div>')[0]).toContain('Book the hotel')
  })
  test('a %% comment does not split a quote in two', () => {
    expect(renderMarkdown(QUOTE_PERCENT).match(/<blockquote/g) ?? []).toHaveLength(1)
  })
})
