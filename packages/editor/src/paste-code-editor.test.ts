// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { pastedMarkdown } from './paste'

const STYLE =
  "color: #cccccc;background-color: #1f1f1f;font-family: Consolas, 'Courier New', monospace;font-weight: normal;font-size: 14px;line-height: 19px;white-space: pre;"
function line(...spans: string[]): string {
  return `<div>${spans.map((span) => `<span style="color: #9cdcfe;">${span}</span>`).join('')}</div>`
}
describe('code copied from a code editor such as VS Code', () => {
  test('is pasted as the code that was copied, not as escaped paragraphs', async () => {
    const text = 'function total(price, qty_count) {\n    return price * qty_count * 2\n}'
    const html = `<meta charset="utf-8"><div style="${STYLE}">${line(
      'function',
      ' total(price, qty_count) {',
    )}${line('    ', 'return', ' price * qty_count * 2')}${line('}')}</div>`
    const pasted = await pastedMarkdown(html, text)
    expect(pasted).toContain('    return price * qty_count * 2')
    expect(pasted).not.toContain('\\*')
    expect(pasted).not.toContain('{\n\n')
  })
  test('keeps an empty line of the copied code', async () => {
    const html = `<div style="${STYLE}">${line('a = 1')}<div><br></div>${line('b = 2')}</div>`
    const pasted = await pastedMarkdown(html, 'a = 1\n\nb = 2')
    expect(pasted).toBe('```\na = 1\n\nb = 2\n```')
  })
})
