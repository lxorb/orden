/** What a note's body counts as showing a picture: only what the renderer draws as
 *  one. A hash written anywhere else - in code, in prose, in a comment - is somebody
 *  naming it, and a deleted account must not hand its bytes to whoever did; see
 *  src/pictures.ts and src/erase.ts. */

import { describe, expect, test } from 'vitest'
import { picturesOf } from '../src/pictures'

const HASH = 'ab'.repeat(32)
const URL = `https://nibeditor.com/i/${HASH}.png`

describe('the pictures a body shows', () => {
  test('are its picture embeds and its image tags', () => {
    expect([...picturesOf(`Before\n\n![a cat](${URL})\n`)]).toEqual([HASH])
    expect([...picturesOf(`![](<${URL}> "title")`)]).toEqual([HASH])
    expect([...picturesOf(`<img alt="x" src="${URL}">`)]).toEqual([HASH])
  })

  /** Every way the app itself puts a picture in a note, a canvas or a cover. */
  test.each([
    ['a picture in a list item', `- item\n\n    ![](${URL})\n`],
    ['a picture in a nested list', `- a\n    - b ![](${URL})\n`],
    ['a picture in a quote', `> ![](${URL})`],
    ['a picture in a callout', `> [!note]\n> ![](${URL})`],
    ['a picture in a table', `| a |\n|---|\n| ![](${URL}) |`],
    ['a picture inside a link', `[![](${URL})](https://example.com)`],
    ['an image tag over several lines', `<div>\n<img\n  src="${URL}">\n</div>`],
    ['a picture whose words hold brackets', `![a [b] c](${URL})`],
    ['a picture after a code span', `\`x\` ![](${URL})`],
    ['a picture under a numbered list', `1. a\n\n\t![](${URL})`],
    ['a wiki embed of the address', `![[${URL}]]`],
    ['a cover', `---\ncover: ${URL}\n---\nbody`],
    ['a page image', `---\nimage: ${URL}\n---\nbody`],
    ['an address without the host', `![](/i/${HASH}.png)`],
    ['an extension in capitals', `![](${URL.replace('.png', '.PNG')})`],
    ['a picture with a size', `![|300](${URL})`],
    ['a picture after a fence that held another mark', `~~~\n\`\`\`\n~~~\n![](${URL})`],
    [
      'a picture card on a canvas',
      JSON.stringify({ nodes: [{ id: 'a', type: 'file', file: URL, x: 0, y: 0 }], edges: [] }),
    ],
    [
      'a picture in a canvas text card',
      JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: `![](${URL})` }], edges: [] }),
    ],
  ])('count %s', (_, body) => {
    expect([...picturesOf(body)]).toEqual([HASH])
  })

  test.each([
    ['prose', `see /i/${HASH} here`],
    ['a link that is not a picture', `[the file](${URL})`],
    ['a code span', `see \`![](${URL})\``],
    ['a fence', `\`\`\`\n![](${URL})\n\`\`\`\n`],
    ['a comment', `%% ![](${URL}) %%`],
    ['another address', `![](https://nibeditor.com/x/${HASH}.png)`],
    ['a canvas text card', JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: URL }] })],
  ])('and not a hash named in %s', (_, body) => {
    expect([...picturesOf(body)]).toEqual([])
  })
})
