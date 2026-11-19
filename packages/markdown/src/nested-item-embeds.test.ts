import { describe, expect, test } from 'vitest'
import { renderMarkdown } from './index'
import type { Wikilink } from './links'

const NOTES: Record<string, string> = {
  steps: '- Setup\n  - Install\n\n    Run the installer twice. ^twice\n',
  long: '1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n10. Ten\n\n    More of step ten. ^ten\n',
  code: '- Setup\n  - Install\n\n    ```js\n    let x = 1\n    ```\n\n    ^snippet\n',
  table: '- Setup\n  - Prices\n\n    | a | b |\n    | - | - |\n    | 1 | 2 |\n\n    ^prices\n',
}
const resolveEmbed = (link: Wikilink) => NOTES[link.target] ?? null
describe('an embed of a block inside a nested list item', () => {
  test('draws the second paragraph of a sub-item as words, not as code', () => {
    const html = renderMarkdown('![[steps#^twice]]', { resolveEmbed })
    expect(html).toContain('<p>Run the installer twice.</p>')
    expect(html).not.toContain('<pre><code>Run the installer')
  })
  test('draws the second paragraph of item ten as words, not as code', () => {
    const html = renderMarkdown('![[long#^ten]]', { resolveEmbed })
    expect(html).toContain('<p>More of step ten.</p>')
  })
  test('draws a fenced block named on its own line as highlighted code without its fences', () => {
    const html = renderMarkdown('![[code#^snippet]]', { resolveEmbed })
    expect(html).toContain('class="language-js"')
    expect(html).not.toContain('```')
  })
  test('draws a table named on its own line as a table', () => {
    const html = renderMarkdown('![[table#^prices]]', { resolveEmbed })
    expect(html).toContain('<table>')
  })
})
