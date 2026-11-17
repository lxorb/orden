// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { pastedMarkdown } from './paste'

function item(mark: string, words: string, last = false): string {
  const kind = last ? 'MsoListParagraphCxSpLast' : 'MsoListParagraphCxSpMiddle'
  return `<p class=${kind} style='margin-left:36.0pt;mso-add-space:auto;text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span lang=EN-GB style='font-family:Symbol;mso-fareast-font-family:Symbol;mso-bidi-font-family:Symbol'><span style='mso-list:Ignore'>${mark}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]><span lang=EN-GB>${words}<o:p></o:p></span></p>`
}

function fromWord(...items: string[]): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta name=Generator content="Microsoft Word 15"></head><body lang=EN-GB><!--StartFragment-->${items.join('\n')}<!--EndFragment--></body></html>`
}

describe('a Word list whose plain text puts a tab after each marker', () => {
  test('a numbered list pastes as a numbered list, not a table', async () => {
    const html = fromWord(item('1.', 'Open the lid'), item('2.', 'Pour', true))
    expect(await pastedMarkdown(html, '1.\tOpen the lid\r\n2.\tPour\r\n')).toBe(
      '1. Open the lid\n2. Pour',
    )
  })

  test('a bulleted list pastes as a list, not a table', async () => {
    const html = fromWord(item('·', 'Milk'), item('·', 'Eggs', true))
    expect(await pastedMarkdown(html, '·\tMilk\r\n·\tEggs\r\n')).toBe('- Milk\n- Eggs')
  })
})
