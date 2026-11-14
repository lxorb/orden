import { expect, test, vi } from 'vitest'

const heard: string[] = []
const held: (() => void)[] = []

vi.mock('../../platform/src/tauri', () => ({
  invoke: (command: string, args: { folder: string }) => {
    heard.push(`${command} ${args.folder}`)
    if (command === 'explorer_watch' && args.folder === '/slow') {
      return new Promise<undefined>((resolve) => held.push(() => resolve(undefined)))
    }
    return Promise.resolve(undefined)
  },
}))

const { unwatchFolder, watchFolder } = await import('./commands')

test('a folder let go while its watch is still on the way is let go after it, never before', async () => {
  const watched = watchFolder('/slow')
  const left = unwatchFolder('/slow')
  const other = watchFolder('/quick')
  await other
  expect(heard).toEqual(['explorer_watch /slow', 'explorer_watch /quick'])
  held.shift()?.()
  await Promise.all([watched, left])
  expect(heard).toEqual(['explorer_watch /slow', 'explorer_watch /quick', 'explorer_unwatch /slow'])
})
