// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { pastedMarkdown } from './paste'

function item(mark: string, words: string, last = false): string {
  const kind = last ? 'MsoListParagraphCxSpLast' : 'MsoListParagraphCxSpMiddle'
  return `<p class=${kind} style='margin-left:36.0pt;mso-add-space:auto;text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span lang=EN-GB style='font-family:Symbol;mso-fareast-font-family:Symbol;mso-bidi-font-family:Symbol'><span style='mso-list:Ignore'>${mark}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]><span lang=EN-GB>${words}<o:p></o:p></span></p>`
}
function fromWord(...items: string[]): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta name=Generator content="Microsoft Word 15"><style><!--p.MsoNormal{margin:0cm;}--></style></head><body lang=EN-GB><!--StartFragment-->${items.join('\n')}<!--EndFragment--></body></html>`
}
describe('a list copied from Microsoft Word', () => {
  test('a bulleted list pastes as a Markdown list', async () => {
    const html = fromWord(item('·', 'Milk'), item('·', 'Eggs', true))
    const text = '·         Milk\r\n·         Eggs\r\n'
    expect(await pastedMarkdown(html, text)).toBe('- Milk\n- Eggs')
  })
  test('a numbered list pastes as a Markdown numbered list', async () => {
    const html = fromWord(item('1.', 'Open the lid'), item('2.', 'Pour', true))
    const text = '1.      Open the lid\r\n2.      Pour\r\n'
    expect(await pastedMarkdown(html, text)).toBe('1. Open the lid\n2. Pour')
  })
})
