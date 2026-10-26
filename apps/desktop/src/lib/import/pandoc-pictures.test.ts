import { describe, expect, test } from 'vitest'

import { toBase64 } from '../bytes'
import { keepPictures, relinked, type PandocPicture } from './pandoc-pictures'

const picture = (link: string, bytes: number[]): PandocPicture => ({
  link,
  data: toBase64(new Uint8Array(bytes)),
})

describe('keepPictures', () => {
  test('each picture is stored under its own name and the links point at it', async () => {
    const stored: { name: string; bytes: number[] }[] = []
    const store = (bytes: Uint8Array, name: string) => {
      stored.push({ name, bytes: [...bytes] })
      return Promise.resolve(`../assets/${name}`)
    }
    const markdown =
      'Text\n\n![a dot](media/rId20.png)\n\n<img src="media/rId21.PNG" width="20" />\n'

    const kept = await keepPictures(
      markdown,
      [picture('media/rId20.png', [1, 2, 3]), picture('media/rId21.PNG', [4])],
      store,
    )

    expect(kept.lost).toBe(0)
    expect(stored.map((one) => one.bytes)).toEqual([[1, 2, 3], [4]])
    for (const one of stored) expect(one.name).toMatch(/^[0-9a-f]{16}\.png$/)
    expect(kept.markdown).toBe(
      `Text\n\n![a dot](../assets/${stored[0]!.name})\n\n<img src="../assets/${stored[1]!.name}" width="20" />\n`,
    )
    expect(kept.markdown).not.toContain('media/')
  })

  test('the same picture is named the same, so it is kept once', async () => {
    const names: string[] = []
    const store = (_: Uint8Array, name: string) => {
      names.push(name)
      return Promise.resolve(name)
    }

    await keepPictures('![](media/a.png)', [picture('media/a.png', [9])], store)
    await keepPictures('![](media/b.png)', [picture('media/b.png', [9])], store)

    expect(names[0]).toBe(names[1])
  })

  test('a picture that could not be stored keeps its link and is counted', async () => {
    const kept = await keepPictures('![](media/a.png)', [picture('media/a.png', [1])], () =>
      Promise.reject(new Error('disk full')),
    )

    expect(kept).toEqual({ markdown: '![](media/a.png)', lost: 1 })
  })

  test('a folder named after the note is encoded in the link', async () => {
    const kept = await keepPictures('![](media/a.png)', [picture('media/a.png', [1])], (_, name) =>
      Promise.resolve(`My Report/${name}`),
    )

    expect(kept.markdown).toMatch(/^!\[\]\(My%20Report\/[0-9a-f]{16}\.png\)$/)
  })
})

describe('relinked', () => {
  test('every way pandoc writes the link is pointed at the new one', () => {
    expect(relinked('![](./media/x.png)', 'media/x.png', 'y.png')).toBe('![](y.png)')
    expect(relinked('![](<media/x.png>)', 'media/x.png', 'y.png')).toBe('![](<y.png>)')
    expect(relinked('![](media/x.png "title")', 'media/x.png', 'y.png')).toBe('![](y.png "title")')
    expect(relinked('[a]: media/x.png', 'media/x.png', 'y.png')).toBe('[a]: y.png')
    expect(relinked("<img src='media/x.png'>", 'media/x.png', 'y.png')).toBe("<img src='y.png'>")
    expect(relinked('![](.\\media\\x.png)', 'media/x.png', 'y.png')).toBe('![](y.png)')
  })

  test('only the whole name, and not words that mention it', () => {
    expect(relinked('![](media/x.png2)', 'media/x.png', 'y.png')).toBe('![](media/x.png2)')
    expect(relinked('see media/x.png here', 'media/x.png', 'y.png')).toBe('see media/x.png here')
    expect(relinked('![](other/media/x.png)', 'media/x.png', 'y.png')).toBe(
      '![](other/media/x.png)',
    )
  })

  test('a replacement with a dollar sign is taken as it is', () => {
    expect(relinked('![](media/x.png)', 'media/x.png', 'a$&b.png')).toBe('![](a$&b.png)')
  })
})
