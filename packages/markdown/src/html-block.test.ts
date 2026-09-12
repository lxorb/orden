import { describe, expect, test } from 'vitest'
import { htmlBlockCard } from './html-block'

const BLOCK = '<div id="dial"></div>\n<script>document.title = "x"</script>'

describe('a block of the note’s own HTML that does something', () => {
  test('becomes a card that holds the block without running it', () => {
    const card = htmlBlockCard(BLOCK) ?? ''
    expect(card).toContain('class="embed-web embed-html"')
    expect(card).toContain('HTML')
    // The block travels in an attribute, where no parser reads it and nothing
    // fetches it. Not a tag on the page: a `<script>` on the page is the one
    // thing this whole arrangement exists to avoid.
    expect(card).toContain('data-srcdoc="&lt;div id=&quot;dial&quot;')
    expect(card).not.toContain('<script')
    expect(card).not.toContain('<div')
  })

  test('and is a button rather than a link, having nowhere to send anybody', () => {
    const card = htmlBlockCard(BLOCK) ?? ''
    expect(card).toContain('role="button"')
    expect(card).not.toContain('href')
  })

  test('takes a fixed piece of room until it says how tall it is', () => {
    expect(htmlBlockCard(BLOCK)).toContain('--embed-height: 180px')
    expect(htmlBlockCard(BLOCK)).not.toContain('embed-wide')
  })

  test('HTML that only shows something is markup like any other', () => {
    // A `<div>`, a `<details>`, a styled span: nothing to run, so nothing to ask
    // about, and the renderer passes it through as it always has.
    for (const html of [
      '<div class="two-up">text</div>',
      '<details><summary>More</summary>text</details>',
      '<span style="color:red">red</span>',
      '<img src="x.png">',
      // Half a script is not a program: marked hands out a lone opening tag when
      // one turns up mid-sentence, and a card in place of it would swallow the
      // words after it.
      '<script>',
      '</script>',
      '',
    ]) {
      expect(htmlBlockCard(html), html).toBe(null)
    }
  })

  test('however the script was written', () => {
    for (const html of [
      '<SCRIPT>alert(1)</SCRIPT>',
      '<script type="module">alert(1)</script >',
      '<div></div><script src="thing.js"></script>',
      'text\n<script>\nalert(1)\n</script>\n',
    ]) {
      expect(htmlBlockCard(html), html).not.toBe(null)
    }
  })
})
