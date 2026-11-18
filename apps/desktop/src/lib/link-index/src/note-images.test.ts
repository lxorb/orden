import { describe, expect, test, vi } from 'vitest'

const found: Record<string, string> = {
  'shot.png': 'assets/shot.png',
  'deep.png': 'notes/pictures/deep.png',
  'Pasted image 2024.png': 'attachments/Pasted image 2024.png',
  'Café.png': 'attachments/Café.png',
  'pictures/deep.png': 'notes/pictures/deep.png',
  'assets/shot.png': 'assets/shot.png',
  'Pasted image 1.png': 'attachments/Pasted image 1.png',
  'attachments/Pasted image 1.png': 'attachments/Pasted image 1.png',
  'Screenshot%202024.png': 'attachments/Screenshot%202024.png',
  'image.png': 'a/image.png',
  '/image.png': 'image.png',
}

const held = new Set([
  'C:\\Notes\\att\\y.png',
  '/Work/assets/shot.png',
  '/Work/notes/pictures/deep.png',
  '/Work/b/image.png',
  '/Work/image.png',
])

vi.mock('./links.svelte', () => ({
  links: {
    fileFor: (name: string) => (found[name] ? `/Work/${found[name]}` : null),
    holdsFile: (path: string) => held.has(path),
    topOf: () => '/Work',
  },
}))

const { notePicture, pictureBeside, picturePath, picturesOf, picturesWrittenOut } =
  await import('./note-images')

describe('a picture a note names', () => {
  test('a bare name is looked for anywhere in the space, the way Obsidian looks', () => {
    expect(notePicture('shot.png', '/Work/notes/Q1.md', '')).toBe('/asset/Work/assets/shot.png')
    expect(notePicture('shot.png', '/Work/Q1.md', '')).toBe('/asset/Work/assets/shot.png')
    expect(notePicture('deep.png', '/Work/Q1.md', '')).toBe('/asset/Work/notes/pictures/deep.png')
  })

  test('a name written the way a link address is, with its spaces and accents encoded', () => {
    expect(notePicture('Pasted%20image%202024.png', '/Work/notes/Q1.md', '')).toBe(
      '/asset/Work/attachments/Pasted%20image%202024.png',
    )
    expect(notePicture('Caf%C3%A9.png', '/Work/Q1.md', '')).toBe(
      '/asset/Work/attachments/Caf%C3%A9.png',
    )
  })

  test('a path is a path beside the note, index or no index', () => {
    expect(notePicture('assets/shot.png', '/Work/Q1.md', '')).toBe('/asset/Work/assets/shot.png')
    expect(notePicture('../assets/shot.png', '/Work/notes/Q1.md', '')).toBe(
      '/asset/Work/assets/shot.png',
    )
  })

  test('a path nothing beside the note holds is looked for the way a link to it is', () => {
    expect(notePicture('pictures/deep.png', '/Work/journal/Today.md', '')).toBe(
      '/asset/Work/notes/pictures/deep.png',
    )
    expect(notePicture('assets/shot.png', '/Work/Q1.md', '')).toBe('/asset/Work/assets/shot.png')
  })

  test('a name written with escapes, as a markdown link writes it, is looked for as it reads', () => {
    expect(notePicture('Pasted%20image%201.png', '/Work/notes/n.md', '')).toBe(
      '/asset/Work/attachments/Pasted%20image%201.png',
    )
    expect(notePicture('attachments/Pasted%20image%201.png', '/Work/notes/n.md', '')).toBe(
      '/asset/Work/attachments/Pasted%20image%201.png',
    )
  })

  test('a name that really holds a percent sign is still found as written', () => {
    expect(notePicture('Screenshot%202024.png', '/Work/notes/n.md', '')).toBe(
      '/asset/Work/attachments/Screenshot%25202024.png',
    )
  })

  test('a bare name is the picture beside the note when one is there', () => {
    expect(notePicture('image.png', '/Work/b/n.md', '')).toBe('/asset/Work/b/image.png')
    expect(notePicture('image.png', '/Work/c/n.md', '')).toBe('/asset/Work/a/image.png')
  })

  test('is the same file an export reads', () => {
    expect(picturePath('shot.png', '/Work/notes/Q1.md', '')).toBe('/Work/assets/shot.png')
    expect(picturePath('image.png', '/Work/b/n.md', '')).toBe('/Work/b/image.png')
    expect(picturePath('https://example.com/pic.png', '/Work/Q1.md', '')).toBeNull()
  })

  test('a name nothing in the space answers to is still tried beside the note', () => {
    expect(notePicture('nowhere.png', '/Work/Q1.md', '')).toBe('/asset/Work/nowhere.png')
  })

  test('one off the network is left exactly where it points', () => {
    expect(notePicture('https://example.com/pic.png', '/Work/Q1.md', '')).toBe(
      'https://example.com/pic.png',
    )
  })

  test('a note with no home yet still finds a picture the space holds', () => {
    expect(notePicture('assets/shot.png', null, '')).toBe('/asset/Work/assets/shot.png')
    expect(notePicture('https://example.com/pic.png', null, '')).toBe('https://example.com/pic.png')
  })

  test('a wikilink names the picture its link means, not the one beside the note', () => {
    expect(notePicture('image.png', '/Work/b/n.md', '', true)).toBe('/asset/Work/a/image.png')
    expect(picturePath('image.png', '/Work/b/n.md', '', true)).toBe('/Work/a/image.png')
  })

  test('a path from the top of the space is the one at the top', () => {
    expect(notePicture('/image.png', '/Work/b/n.md', '')).toBe('/asset/Work/image.png')
    expect(picturePath('/image.png', '/Work/b/n.md', '')).toBe('/Work/image.png')
  })

  test('a typora-root-url still decides where a path from the top starts', () => {
    const source = '---\ntypora-root-url: /Work/notes\n---\n'
    expect(picturePath('/pictures/deep.png', '/Work/b/n.md', source)).toBe(
      '/Work/notes/pictures/deep.png',
    )
  })

  test('inside an embedded note is the one that note names, ready to draw', () => {
    const pictures = picturesOf('/Work/Index.md', '', (path) => `/asset${path}`)
    const plan = { text: '', escapeHtml: false, path: '/Work/notes/Plan.md' }

    expect(pictures('../assets/shot.png', false, plan)).toBe('/asset/Work/assets/shot.png')
    expect(pictures('pictures/deep.png', false, plan)).toBe('/asset/Work/notes/pictures/deep.png')
    expect(pictures('assets/shot.png', false, null)).toBeNull()
    expect(pictures('image.png', true, null)).toBe('/asset/Work/a/image.png')
  })

  test('inside an embedded note is found even when the page has no home yet', () => {
    const pictures = picturesOf(null, '', (path) => path)
    const plan = { text: '', escapeHtml: false, path: '/Work/notes/Plan.md' }

    expect(pictures('../assets/shot.png', false, plan)).toBe('/Work/assets/shot.png')
  })

  test('a path already found is found again as itself', () => {
    expect(picturePath('/Work/assets/shot.png', '/Work/b/n.md', '')).toBe('/Work/assets/shot.png')
    expect(picturePath('/Work/notes/pictures/deep.png', null, '')).toBe(
      '/Work/notes/pictures/deep.png',
    )
  })
})

describe('a note sent to pandoc', () => {
  test('names each picture by the path pandoc can read beside the note', () => {
    const source =
      '---\ncover: "[[shot.png]]"\n---\n\nSee ![[shot.png|the shot]] and ![](shot.png).\n'

    expect(picturesWrittenOut(source, '/Work/notes/Q1.md')).toBe(
      '---\ncover: "[[shot.png]]"\n---\n\nSee ![the shot](../assets/shot.png) and ![](../assets/shot.png).\n',
    )
  })

  test('keeps a size as no words and leaves what it cannot find as written', () => {
    expect(picturesWrittenOut('![[shot.png|300]] ![[gone.png]]', '/Work/Q1.md')).toBe(
      '![](assets/shot.png) ![[gone.png]]',
    )
  })

  test('names a picture on Windows by a path beside the note', () => {
    expect(picturesWrittenOut('![](../att/y.png)', 'C:\\Notes\\b\\n.md')).toBe('![](../att/y.png)')
  })
})

describe('a picture an export writes into its page', () => {
  test('is a path beside the note, on every system', () => {
    expect(pictureBeside('/Work/b/n.md')('/Work/att/x.png')).toBe('../att/x.png')
    expect(pictureBeside('C:\\Notes\\b\\n.md')('C:\\Notes\\att\\50%.png')).toBe('../att/50%25.png')
  })

  test('is the file itself when nothing leads there from the note', () => {
    expect(pictureBeside('C:\\Notes\\n.md')('D:\\Pics\\x.png')).toBe('D:\\Pics\\x.png')
    expect(pictureBeside(null)('/Work/att/x.png')).toBe('/Work/att/x.png')
  })

  test('is every picture the page names, for an export with no second look', () => {
    const pictures = picturesOf('/Work/b/n.md', '', pictureBeside('/Work/b/n.md'), true)
    expect(pictures('shot.png', false, null)).toBe('../assets/shot.png')
    expect(pictures('/image.png', false, null)).toBe('../image.png')
  })
})
