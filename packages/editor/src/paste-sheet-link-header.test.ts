// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { pastedMarkdown } from './paste'

const SHEETS_HTML =
  '<meta charset="utf-8"><google-sheets-html-origin><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" data-sheets-root="1"><colgroup><col width="100"/><col width="160"/></colgroup><tbody><tr style="height:21px;"><td>Name</td><td>Site</td></tr><tr style="height:21px;"><td>Apple</td><td><a class="in-cell-link" href="https://apple.com" target="_blank">https://apple.com</a></td></tr></tbody></table>'
const SHEETS_TEXT = 'Name\tSite\nApple\thttps://apple.com'
const EXCEL_HTML =
  '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><body link="#0563C1"><!--StartFragment--><table border=0 cellpadding=0 cellspacing=0 width=128><col width=64 span=2><tr height=20><td height=20 width=64>Name</td><td width=64>Site</td></tr><tr height=20><td height=20>Apple</td><td class=xl65><a href="https://apple.com/">https://apple.com/</a></td></tr><!--EndFragment--></table></body></html>'
const EXCEL_TEXT = 'Name\tSite\r\nApple\thttps://apple.com/\r\n'
describe('a spreadsheet range with a link cell pasted into a note', () => {
  test('from Google Sheets keeps its first row as the header, as a range without links does', async () => {
    const written = (await pastedMarkdown(SHEETS_HTML, SHEETS_TEXT)) ?? ''
    expect(written.split('\n')[0]).toBe('| Name | Site |')
  })
  test('from Excel keeps its first row as the header', async () => {
    const written = (await pastedMarkdown(EXCEL_HTML, EXCEL_TEXT)) ?? ''
    expect(written.split('\n')[0]).toBe('| Name | Site |')
  })
})
