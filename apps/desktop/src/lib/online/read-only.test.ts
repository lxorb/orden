import { beforeEach, expect, test, vi } from 'vitest'

/** A new online terminal is a `.term` file written into the space in front. A space
 *  somebody shared with this account to be read is one nothing may be written in,
 *  and the sync would refuse the file on every pass, so none is made there. */

const readOnly = vi.hoisted(() => new Set<string>())
const written = vi.hoisted(() => [] as string[])

vi.mock('../sharing.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sharing.svelte')>()),
  canWriteAt: (path: string) =>
    ![...readOnly].some((root) => path === root || path.startsWith(`${root}/`)),
}))

vi.mock('../workspace/write-file', () => ({
  writeFile: (path: string) => {
    written.push(path)
    return Promise.resolve()
  },
}))

vi.mock('../account.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../account.svelte')>()
  Object.defineProperty(real.account, 'accountToken', { get: () => 'token' })
  return real
})

vi.mock('./machine.svelte', () => ({
  machine: { refresh: () => Promise.resolve(), known: { allowed: true }, refused: null },
}))

const { workspace } = await import('../workspace.svelte')
const { openOnline } = await import('./open')

beforeEach(() => {
  readOnly.clear()
  written.length = 0
  vi.restoreAllMocks()
  vi.spyOn(workspace, 'fileCame').mockResolvedValue(undefined)
  vi.spyOn(workspace, 'loadTree').mockResolvedValue(undefined)
})

function inFront(root: string) {
  vi.spyOn(workspace, 'activeSpace', 'get').mockReturnValue({ id: root, name: root, root })
}

test('writes no terminal into a space shared to be read', async () => {
  readOnly.add('/theirs')
  inFront('/theirs')

  expect(await openOnline()).toBeNull()
  expect(written).toEqual([])
})

test('writes one into a space that may be written', async () => {
  inFront('/mine')

  await openOnline()
  expect(written).toEqual(['/mine/Terminal.term'])
})
