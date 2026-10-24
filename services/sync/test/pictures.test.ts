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

  test.each([
    ['prose', `see /i/${HASH} here`],
    ['a link that is not a picture', `[the file](${URL})`],
    ['a code span', `see \`![](${URL})\``],
    ['a fence', `\`\`\`\n![](${URL})\n\`\`\`\n`],
    ['a comment', `%% ![](${URL}) %%`],
    ['another address', `![](https://nibeditor.com/x/${HASH}.png)`],
  ])('and not a hash named in %s', (_, body) => {
    expect([...picturesOf(body)]).toEqual([])
  })
})
