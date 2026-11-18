// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { pastedMarkdown } from './paste'

const SPAN =
  'font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;'

function item(words: string): string {
  return `<li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="${SPAN}">${words}</span></p></li>`
}

describe('a bulleted list copied from Google Docs', () => {
  test('pastes as a tight list, as it was drawn there', async () => {
    const html = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-5c1f"><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">${item('Milk')}${item('Eggs')}${item('Bread')}</ul></b>`
    expect(await pastedMarkdown(html, 'Milk\nEggs\nBread')).toBe('- Milk\n- Eggs\n- Bread')
  })
})
