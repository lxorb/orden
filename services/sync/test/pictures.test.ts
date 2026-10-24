/** What a note's body counts as showing a picture: only what the renderer draws as
 *  one. A hash written anywhere else - in code, in prose, in a comment - is somebody
 *  naming it, and a deleted account must not hand its bytes to whoever did; see
 *  src/pictures.ts and src/erase.ts. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { picturesOf } from '../src/pictures'
import { call, mail, signIn, type TestEnv, testEnv } from './harness'

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
    ['a picture by reference', `![a][r]\n\n[r]: ${URL}\n`],
    ['an image tag with a source set', `<img srcset="${URL} 2x">`],
    ['an image tag whose words hold a bracket', `<img alt="a>b" src="${URL}">`],
    [
      'an image tag with an entity in its address',
      `<img src="https://nibeditor.com&#47;i/${HASH}.png">`,
    ],
    ['a picture element', `<picture><source srcset="${URL}"><img src="x.png"></picture>`],
    ['a film with a poster', `<video poster="${URL}"></video>`],
    ['a background in a style', `<div style="background-image:url(${URL})">x</div>`],
    ['a picture by a shortcut reference', `![l]\n\n[l]: ${URL}\n`],
    [
      'a group behind a picture on a canvas',
      JSON.stringify({ nodes: [{ type: 'group', background: URL }] }),
    ],
    ['a picture by a collapsed reference', `![Shot][]\n\n[shot]: <${URL}>\n`],
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
    ['inline maths, which is drawn as code', `$![x](${URL})$`],
    ['an indented code block', `para\n\n    ![x](${URL})\n`],
    ['an escaped picture, which is a link', `\\![x](${URL})`],
    ['an HTML comment', `<!-- ![x](${URL}) -->`],
    ['the words of an image tag', `<img alt="${URL}" src="https://example.com/y.png">`],
    ['a tag that is not the source', `<img data-src="${URL}">`],
    ['the words between tags', `<p>see ${URL}</p>`],
    ['a tag the renderer escapes as words', `<img/src="${URL}">`],
    ['a link tag', `<a href="${URL}">the file</a>`],
    ['an autolink', `<${URL}>`],
    ['a link card on a canvas', JSON.stringify({ nodes: [{ type: 'link', url: URL }] })],
    ['a reference defined only in code', `![a][l]\n\n\`\`\`\n[l]: ${URL}\n\`\`\`\n`],
    ['a cover that is not at the top', `hi\n\n---\ncover: ${URL}\n---\n`],
    ['another key of the front matter', `---\nlink: ${URL}\n---\nhi`],
    ['a reference only a link uses', `[a][r]\n\n[r]: ${URL}\n`],
    ['a code span', `see \`![](${URL})\``],
    ['a fence', `\`\`\`\n![](${URL})\n\`\`\`\n`],
    ['a comment', `%% ![](${URL}) %%`],
    ['another address', `![](https://nibeditor.com/x/${HASH}.png)`],
    ['a canvas text card', JSON.stringify({ nodes: [{ id: 'a', type: 'text', text: URL }] })],
  ])('and not a hash named in %s', (_, body) => {
    expect([...picturesOf(body)]).toEqual([])
  })
})

/** In a note whose HTML is live - a space nobody else is in, where the renderer draws
 *  raw HTML as markup - every address anywhere in that HTML counts, however a browser
 *  would come to load it: over-counting there keeps the owner's own bytes and nothing
 *  else. Anywhere else, and in prose, the strict reading above stands. */
describe('the pictures of a note whose HTML is live', () => {
  const split = `https://nibeditor.com/i/${HASH.slice(0, 32)}`
  test.each([
    ['an image in an svg', `<svg><image href="${URL}" width="10" height="10"/></svg>`],
    ['a style element', `<style>.x{background:url(${URL})}</style><div class="x">a</div>`],
    ['a table background', `<table background="${URL}"><tr><td>a</td></tr></table>`],
    ['an image set in a style', `<div style='background-image:image-set("${URL}" 1x)'>a</div>`],
    ['a line break inside an address', `<img src="${split}\n${HASH.slice(32)}.png">`],
    ['a tab written as a reference', `<img src="${split}&Tab;${HASH.slice(32)}.png">`],
  ])('count %s, and only there', (_, body) => {
    expect([...picturesOf(body, true)]).toEqual([HASH])
    expect([...picturesOf(body)]).toEqual([])
  })

  test('and still not a hash in its prose or its code', () => {
    expect([...picturesOf(`see ${URL} and \`${URL}\``, true)]).toEqual([])
  })
})

describe('what a saved note writes down', () => {
  let env: TestEnv
  let token: string
  let space: string
  const body = `<svg><image href="${URL}"/></svg>`
  const kept = () => env.db.prepare('select hash from note_pictures').all()

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')
    space = (await call(env, '/v1/spaces', { token, body: { name: 'Mine' } })).json.space.id
  })
  afterEach(() => env.close())

  test('reads live HTML in a space nobody else is in', async () => {
    await call(env, `/v1/spaces/${space}/notes`, { token, body: { path: 'A.md', content: body } })
    expect(kept()).toEqual([{ hash: HASH }])
  })

  test('and HTML as words in a space somebody else is in', async () => {
    await mail(() =>
      call(env, `/v1/spaces/${space}/share/invite`, {
        token,
        body: { email: 'other@b.dev', role: 'write' },
      }),
    )
    await call(env, `/v1/spaces/${space}/notes`, { token, body: { path: 'A.md', content: body } })
    expect(kept()).toEqual([])
  })
})
