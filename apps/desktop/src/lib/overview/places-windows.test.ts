import { beforeEach, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../test/disk'

type Places = typeof import('./places.svelte').places

async function window(slot: number): Promise<Places> {
  vi.resetModules()
  const { places } = await import('./places.svelte')
  places.own(slot)
  return places
}

const tab = (id: string, path: string) => ({ id, kind: 'note', path, shown: path })
const box = (x: number) => ({ x, y: 0, w: 100, h: 80 })

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

test('two windows keep their own laid out windows, so neither forgets the other', async () => {
  const first = await window(0)
  const second = await window(1)
  const a = tab('a', '/a.md')
  const b = tab('b', '/b.md')

  first.keepWindows({ a: box(1) }, [a])
  second.keepWindows({ b: box(2) }, [b])
  first.keepWindows({ a: box(3) }, [a])

  const back = await window(1)
  back.recall([b])
  expect(back.windows).toEqual({ b: box(2) })
})

test('a window arranging spaces does not put back what another window moved since', async () => {
  const first = await window(0)
  const second = await window(1)

  second.arrange({ work: box(5) })
  first.arrange({ home: box(6) })

  expect((await window(1)).at('work')).toEqual(box(5))
})

test('tidying one window leaves the other window as it was', async () => {
  const first = await window(0)
  const second = await window(1)
  const b = tab('b', '/b.md')

  second.keepWindows({ b: box(2) }, [b])
  second.arrange({ work: box(5) })
  first.tidy()

  const back = await window(1)
  back.recall([b])
  expect(back.windows).toEqual({ b: box(2) })
  expect(back.at('work')).toEqual(box(5))
})

test('a new window starts from how the first window was laid out', async () => {
  const first = await window(0)
  const a = tab('a', '/a.md')
  first.keepWindows({ a: box(1) }, [a])
  first.arrange({ home: box(6) })

  const fresh = await window(2)
  fresh.recall([tab('copy', '/a.md')])
  expect(fresh.windows).toEqual({ copy: box(1) })
  expect(fresh.at('home')).toEqual(box(6))
})
