/** Where a clip is written: in the space the tab belongs to, which is not always the
 *  one on screen, since tabs stay in the strip across a switch. See clip.ts. */

import { beforeEach, expect, test, vi } from 'vitest'

const wrote: { text: string; folder: string | undefined }[] = []
const notice = { value: null as string | null }

vi.mock('../workspace.svelte', () => ({
  workspace: {
    activeSpace: { id: 'home', root: '/Home' },
    spaces: [
      { id: 'home', root: '/Home' },
      { id: 'work', root: '/Work' },
    ],
    noteFrom: (text: string, folder?: string) => {
      wrote.push({ text, folder })
      return Promise.resolve(folder === '/Work' ? '/Work/A.md' : null)
    },
  },
}))
vi.mock('./pages.svelte', () => ({
  pages: {
    read: () => Promise.resolve({ url: 'https://a.example/', title: 'A', html: '<p>hi</p>' }),
    of: () => ({
      set notice(said: string | null) {
        notice.value = said
      },
    }),
  },
}))
vi.mock('./note', () => ({
  clipNote: () => Promise.resolve('# A\n'),
  clipSource: (url: string) => url,
}))

const { clipPage } = await import('./clip')

beforeEach(() => {
  wrote.length = 0
  notice.value = null
})

test('a clip from a tab of another space is written in that space', async () => {
  // The tab's file is in Work; Home is in front.
  const path = await clipPage('t', 'work', { url: 'https://a.example/', title: 'A' })

  expect(wrote).toEqual([{ text: '# A\n', folder: '/Work' }])
  expect(path).toBe('/Work/A.md')
  expect(notice.value).toBeNull()
})

test('a clip from a tab whose space is gone is refused, with a word on the tab', async () => {
  const path = await clipPage('t', 'gone', { url: 'https://a.example/', title: 'A' })

  expect(wrote).toEqual([])
  expect(path).toBeNull()
  expect(notice.value).toContain('Save as a note')
})

test('a clip into a space that may only be read is refused, with a word on the tab', async () => {
  const path = await clipPage('t', 'home', { url: 'https://a.example/', title: 'A' })

  expect(path).toBeNull()
  expect(notice.value).toContain('Save as a note')
})
