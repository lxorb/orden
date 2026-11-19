import { expect, test, vi } from 'vitest'

const left = vi.hoisted(() => ({ times: 0 }))
vi.mock('../../ui-kit/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui-kit/src/api')>()),
  fullscreen: {
    leave: () => {
      left.times += 1
      return Promise.resolve()
    },
  },
}))
const { answer, readAsk } = await import('./passed.svelte')
test('Escape is one of the words a page can say, and nothing new besides', () => {
  expect(readAsk({ tab: 'web-1', key: 'escape' })).toEqual({ tab: 'web-1', key: 'escape' })
  expect(readAsk({ tab: 'web-1', key: 'fullscreen' })).toBeNull()
})
test('and it gives the screen back', () => {
  answer('web-1', {} as never, 'escape')
  expect(left.times).toBe(1)
})
test('a store page asking to install opens the tab’s extensions, where it is said how that went', async () => {
  const { extensions } = await import('./extensions.svelte')
  const installed: string[] = []
  vi.spyOn(extensions, 'install').mockImplementation((link: string) => {
    installed.push(link)
    return Promise.resolve(false)
  })
  answer('web-2', { url: 'https://chromewebstore.google.com/detail/x/abc' } as never, 'install')
  await vi.waitFor(() => expect(installed).toEqual(['https://chromewebstore.google.com/detail/x/abc']))
  expect(extensions.shownIn).toBe('web-2')
})
