import { describe, expect, test } from 'vitest'
import { readOutline } from './outline'

const ref = (page: number) => ({ num: page * 10, gen: 0 })

function docWith(outline: unknown) {
  return {
    getOutline: () => Promise.resolve(outline),
    getDestination: (name: string) => Promise.resolve(name === 'named' ? [ref(4)] : null),
    getPageIndex: (one: { num: number }) => Promise.resolve(one.num / 10 - 1),
  } as unknown as Parameters<typeof readOutline>[0]
}

describe("a PDF's outline", () => {
  test('is every part with its page and how deep it is, in reading order', async () => {
    const doc = docWith([
      {
        title: 'One',
        dest: [ref(1)],
        items: [{ title: ' One, a ', dest: [ref(2)], items: [] }],
      },
      { title: 'Named', dest: 'named', items: [] },
    ])
    expect(await readOutline(doc)).toEqual([
      { title: 'One', page: 1, level: 0 },
      { title: 'One, a', page: 2, level: 1 },
      { title: 'Named', page: 4, level: 0 },
    ])
  })

  test('leaves out a part whose page cannot be found, and keeps the parts inside it', async () => {
    const doc = docWith([
      { title: 'Lost', dest: 'gone', items: [{ title: 'Kept', dest: [2], items: [] }] },
    ])
    expect(await readOutline(doc)).toEqual([{ title: 'Kept', page: 3, level: 1 }])
  })

  test('is nothing for a PDF that wrote none', async () => {
    expect(await readOutline(docWith(null))).toEqual([])
  })
})
