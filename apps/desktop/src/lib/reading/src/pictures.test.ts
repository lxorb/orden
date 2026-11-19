import { expect, test, vi } from 'vitest'

const asked: string[] = []
vi.mock('../../link-index/src/api', () => ({
  links: {},
  queryRowsHtml: () => '',
  picturesOf: () => () => null,
  notePicture: (src: string) => {
    asked.push(src)
    return `/asset/Work/attachments/${encodeURIComponent(src)}?a=1&b=2`
  },
}))
const { withPictures } = await import('./render')
test('a picture in the reading view is looked up by the name it has, not as the page writes it', () => {
  const html = withPictures('<p><img src="R&amp;D.png" alt=""></p>', {
    text: '',
    path: '/Work/n.md',
  })
  expect(asked).toEqual(['R&D.png'])
  expect(html).toBe('<p><img src="/asset/Work/attachments/R%26D.png?a=1&amp;b=2" alt=""></p>')
})
