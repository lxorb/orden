import { expect, test, vi } from 'vitest'

const sent = vi.hoisted(() => [] as string[])

vi.mock('./commands', () => ({
  clashesIn: () => Promise.resolve([]),
  transfer: (_job: string, sources: string[], folder: string) => {
    sent.push(`${sources.join(',')} -> ${folder}`)
    return Promise.resolve({
      done: sources.map((from) => ({ from, to: `${from} copy` })),
      replaced: [],
      skipped: [],
      failed: [],
      cancelled: false,
    })
  },
}))
vi.mock('./open', () => ({ inASpace: () => false }))

const { duplicate } = await import('./changes')

const view = (search: boolean) =>
  ({
    listing: { path: '/home/me', own: false, spaces: false },
    search: search ? { root: '/home/me' } : null,
    reload: () => Promise.resolve(),
    tell: vi.fn(),
  }) as never

test('a file found below is duplicated beside itself, not into the folder searched', async () => {
  sent.length = 0
  await duplicate(view(true), [
    '/home/me/letters/bank.txt',
    '/home/me/letters/rent.txt',
    '/home/me/old/bank.txt',
    '/home/me/top.txt',
  ])
  expect(sent).toEqual([
    '/home/me/letters/bank.txt,/home/me/letters/rent.txt -> /home/me/letters',
    '/home/me/old/bank.txt -> /home/me/old',
    '/home/me/top.txt -> /home/me',
  ])
})

test('a file in the folder shown is duplicated into it', async () => {
  sent.length = 0
  await duplicate(view(false), ['/home/me/a.txt', '/home/me/b.txt'])
  expect(sent).toEqual(['/home/me/a.txt,/home/me/b.txt -> /home/me'])
})
