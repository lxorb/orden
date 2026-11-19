// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { pastedMarkdown } from './paste'

function span(words: string, decoration: string, align: string): string {
  return `<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:${decoration};vertical-align:${align};white-space:pre;white-space:pre-wrap;">${words}</span>`
}
function docs(...spans: string[]): string {
  return `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-7a1b"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">${spans.join('')}</p></b>`
}
async function shown(html: string, text: string): Promise<string> {
  return renderMarkdown((await pastedMarkdown(html, text)) ?? '')
}
describe('words pasted from Google Docs', () => {
  test('struck through words stay struck through', async () => {
    const html = docs(span('Call Bob', 'line-through', 'baseline'), span(' then lunch', 'none', 'baseline'))
    expect(await shown(html, 'Call Bob then lunch')).toContain('<del>Call Bob</del>')
  })
  test('a superscript power stays a power rather than joining the number', async () => {
    const html = docs(span('10', 'none', 'baseline'), span('6', 'none', 'super'), span(' cells', 'none', 'baseline'))
    const drawn = await shown(html, '106 cells')
    expect(drawn).toContain('10<sup>6</sup>')
    expect(drawn).not.toContain('106')
  })
  test('a subscript stays a subscript', async () => {
    const html = docs(span('H', 'none', 'baseline'), span('2', 'none', 'sub'), span('O', 'none', 'baseline'))
    expect(await shown(html, 'H2O')).toContain('H<sub>2</sub>O')
  })
})
