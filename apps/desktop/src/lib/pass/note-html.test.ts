import { describe, expect, test } from 'vitest'
import { noteHtml } from './note-html'

const PIXEL = 'data:image/png;base64,iVBORw0KGgo='

describe('a note shown in Pass', () => {
  test('shows a picture from elsewhere as a link, so opening the item fetches nothing', () => {
    const html = noteHtml('see ![the logo](https://tracker.example/p.png?who=me "Logo")')
    expect(html).not.toContain('<img')
    expect(html).toContain('<a href="https://tracker.example/p.png?who=me"')
    expect(html).toContain('>the logo</a>')
  })

  test('names the address when the picture has no words', () => {
    expect(noteHtml('![](https://x.example/a.png)')).toContain('>https://x.example/a.png</a>')
  })

  test('keeps a picture carried inside the note', () => {
    const html = noteHtml(`![dot](${PIXEL})`)
    expect(html).toContain(`<img src="${PIXEL}"`)
  })

  test('keeps the rest of the markdown and its escaping', () => {
    const html = noteHtml('**bold** <img src=https://x.example/a.png>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).not.toContain('<img')
  })
})
