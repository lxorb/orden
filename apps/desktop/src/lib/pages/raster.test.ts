import { afterEach, expect, test, vi } from 'vitest'

const paper = vi.hoisted(() => ({ widths: [] as number[], asked: 0 }))

vi.mock('./paper', () => ({
  paperOf: () => {
    const width = paper.widths[paper.asked++] ?? 0
    return Promise.resolve({ image: { width, height: width }, width, height: width })
  },
}))

const { paperPicture } = await import('./raster')

const drawn = vi.fn()

vi.stubGlobal('document', {
  createElement: () => ({
    getContext: () => ({ drawImage: drawn }),
    toDataURL: () => 'data:image/png;base64,AAAA',
  }),
})

afterEach(() => {
  paper.asked = 0
  drawn.mockClear()
})

const AT = { file: 'Paper.pdf', note: '/n/P.pages', root: '/n' }

test('a page let go of on the way is drawn again', async () => {
  paper.widths = [0, 100]
  expect(await paperPicture(AT, 1)).toBe('data:image/png;base64,AAAA')
  expect(paper.asked).toBe(2)
  expect(drawn).toHaveBeenCalledTimes(1)
})

test('a page that will not stay is no page', async () => {
  paper.widths = [0, 0]
  expect(await paperPicture(AT, 1)).toBeNull()
  expect(drawn).not.toHaveBeenCalled()
})
