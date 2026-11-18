// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { pastedMarkdown } from './paste'

const EXCEL_CELL = [
  '<html xmlns:v="urn:schemas-microsoft-com:vml"',
  'xmlns:o="urn:schemas-microsoft-com:office:office"',
  'xmlns:x="urn:schemas-microsoft-com:office:excel"',
  'xmlns="http://www.w3.org/TR/REC-html40">',
  '<head><meta name=ProgId content=Excel.Sheet><style><!--td {padding-top:1px;}--></style></head>',
  '<body link="#0563C1" vlink="#954F72">',
  "<table border=0 cellpadding=0 cellspacing=0 width=64 style='border-collapse:collapse;width:48pt'>",
  " <col width=64 style='width:48pt'>",
  " <tr height=20 style='height:15.0pt'>",
  '<!--StartFragment-->',
  "  <td height=20 width=64 style='height:15.0pt;width:48pt'>Order 4471 shipped</td>",
  '<!--EndFragment-->',
  ' </tr>',
  '</table>',
  '</body>',
  '</html>',
].join('\r\n')

const LIBREOFFICE_CELL =
  '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN"><html><head><meta name="generator" content="LibreOffice 7.6"/></head><body><table cellspacing="0" border="0"><colgroup width="85"></colgroup><tr><td height="17" align="left">Order 4471 shipped</td></tr></table></body></html>'

describe('one cell copied from a spreadsheet and pasted into a note', () => {
  test('from Excel pastes its words, not a table of one cell', async () => {
    expect(await pastedMarkdown(EXCEL_CELL, 'Order 4471 shipped\r\n')).toBe('Order 4471 shipped')
  })

  test('from LibreOffice Calc pastes its words, not a table of one cell', async () => {
    expect(await pastedMarkdown(LIBREOFFICE_CELL, 'Order 4471 shipped')).toBe('Order 4471 shipped')
  })
})
