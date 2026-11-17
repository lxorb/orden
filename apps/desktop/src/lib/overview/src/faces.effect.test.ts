import 'fake-indexeddb/auto'
import { expect, test } from 'vitest'
import { drawInto, forgetFaces, readFaces, writeFace } from './faces'

test('a picture drawn again brings nothing that runs, loads or restyles the app', () => {
  const into = document.createElement('div')
  drawInto(
    into,
    '<div class="pane" onclick="alert(1)"><script>alert(2)</script><style>body{display:none}</style>' +
      '<iframe src="https://example.com"></iframe><a href="javascript:alert(3)">x</a>' +
      '<img src="data:image/webp;base64,AA==" onerror="alert(4)"><p class="cm-line">words</p></div>',
  )
  expect(into.querySelector('script, style, iframe')).toBe(null)
  expect(into.querySelector('[onclick], [onerror]')).toBe(null)
  expect(into.querySelector('a')?.hasAttribute('href')).toBe(false)
  expect(into.querySelector('img')?.getAttribute('src')).toBe('data:image/webp;base64,AA==')
  expect(into.querySelector('.cm-line')?.textContent).toBe('words')
})

test('pictures are kept in the store by name, read back, and let go', async () => {
  const one = { html: '<p>a</p>', shot: null, w: 10, h: 10, at: 1 }
  await writeFace('note:/a.md', one)
  await writeFace('terminal:~zsh', { ...one, at: 2 })
  expect(new Map(await readFaces()).get('note:/a.md')).toEqual(one)
  await forgetFaces(['note:/a.md'])
  expect((await readFaces()).map(([name]) => name)).toEqual(['terminal:~zsh'])
})
