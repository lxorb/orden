// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { pastedMarkdown } from './paste'

const CALC_HTML = [
  '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">',
  '<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"/>',
  '<title></title><meta name="generator" content="LibreOffice 7.6.4.1 (Linux)"/>',
  '<style type="text/css">body,div,table,thead,tbody,tfoot,tr,th,td,p { font-family:"Liberation Sans"; font-size:x-small }</style>',
  '</head><body><table cellspacing="0" border="0">',
  '<colgroup width="85"></colgroup><colgroup width="160"></colgroup>',
  '<tr><td height="17" align="left">Name</td><td align="left">Site</td></tr>',
  '<tr><td height="17" align="left">Apple</td><td align="left"><a href="https://apple.com/">https://apple.com/</a></td></tr>',
  '</table></body></html>',
].join('\n')
const CALC_TEXT = 'Name\tSite\nApple\thttps://apple.com/\n'
const CALC_PLAIN_HTML = CALC_HTML.replace('<a href="https://apple.com/">https://apple.com/</a>', 'https://apple.com/')
describe('a LibreOffice Calc range pasted into a note', () => {
  test('without a link cell, its first row is the header', async () => {
    const written = (await pastedMarkdown(CALC_PLAIN_HTML, CALC_TEXT)) ?? ''
    expect(written.split('\n')[0]).toBe('| Name | Site |')
  })
  test('with a link cell, its first row is still the header, as from Excel or Google Sheets', async () => {
    const written = (await pastedMarkdown(CALC_HTML, CALC_TEXT)) ?? ''
    expect(written.split('\n')[0]).toBe('| Name | Site |')
  })
})
