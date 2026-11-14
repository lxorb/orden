import { beforeEach, expect, test, vi } from 'vitest'

const readOnly = vi.hoisted(() => new Set<string>())
const written = vi.hoisted(() => [] as { path: string; text: string }[])

vi.mock('../../../sharing/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../sharing/src/sharing.svelte')>()),
  canWriteAt: (path: string) =>
    ![...readOnly].some((root) => path === root || path.startsWith(`${root}/`)),
}))

vi.mock('../../../workspace/write-file', () => ({
  writeFile: (path: string, text: string) => {
    written.push({ path, text })
    return Promise.resolve()
  },
}))

vi.mock('../../../accounts/src/account.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../accounts/src/account.svelte')>()
  Object.defineProperty(real.account, 'accountToken', { get: () => 'token' })
  return real
})

vi.mock('./machine.svelte', () => ({
  machine: { refresh: () => Promise.resolve(), known: { allowed: true }, refused: null },
}))

vi.mock('./calls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./calls')>()),
  termSession: () => Promise.resolve({ v: 1, machine: 'm_1', session: 's_1' }),
}))

const { workspace } = await import('../../../workspace.svelte')
const { isUnsaved } = await import('../../../workspace/drafts')
const { madeOnline, openOnline } = await import('./open')
const { isOnlineTab } = await import('../../../online-terms/src/api')

const WORDS = '{"v":1,"machine":"m_1","session":"s_1"}\n'

beforeEach(() => {
  readOnly.clear()
  written.length = 0
  vi.restoreAllMocks()
  vi.spyOn(workspace, 'fileCame').mockResolvedValue(undefined)
  vi.spyOn(workspace, 'loadTree').mockResolvedValue(undefined)
  vi.spyOn(workspace, 'freeNameOnDisk').mockImplementation((_dir, name) => Promise.resolve(name))
})

function inFront(root: string) {
  vi.spyOn(workspace, 'activeSpace', 'get').mockReturnValue({ id: root, name: root, root })
}

test('opens as a tab not saved: nothing written, no row in the list', async () => {
  inFront('/mine')
  const rows = vi.spyOn(workspace, 'showEntry')

  const tab = await openOnline()
  expect(tab?.kind).toBe('terminal')
  expect(tab?.path).toBeNull()
  expect(tab?.doc).toBe(WORDS)
  expect(tab && isOnlineTab(tab)).toBe(true)
  expect(tab && isUnsaved(tab.note)).toBe(true)
  expect(written).toEqual([])
  expect(rows).not.toHaveBeenCalled()
})

test('saved, is its .term in the folder given, a row in the list, and the same session', async () => {
  inFront('/mine')
  const rows = vi.spyOn(workspace, 'showEntry')
  vi.spyOn(workspace, 'writableAt').mockResolvedValue(true)
  vi.spyOn(workspace, 'nestFor').mockResolvedValue(undefined)
  const tab = await openOnline()
  if (!tab) throw new Error('no tab')

  expect(await workspace.save(tab, '/mine')).toBe('/mine/Terminal.term')
  expect(written).toEqual([{ path: '/mine/Terminal.term', text: WORDS }])
  expect(rows).toHaveBeenCalledTimes(1)
  expect(tab.path).toBe('/mine/Terminal.term')
  expect(isOnlineTab(tab)).toBe(true)
  expect(isUnsaved(tab.note)).toBe(false)
})

test('is never written into a space shared to be read', async () => {
  readOnly.add('/theirs')
  inFront('/theirs')
  vi.spyOn(workspace, 'writableAt').mockResolvedValue(true)
  vi.spyOn(workspace, 'nestFor').mockResolvedValue(undefined)
  const tab = await openOnline()
  if (!tab) throw new Error('no tab')

  expect(await workspace.save(tab, '/theirs')).toBeNull()
  expect(written).toEqual([])
})

test('renamed before it is saved, is saved under that name', async () => {
  inFront('/mine')
  vi.spyOn(workspace, 'writableAt').mockResolvedValue(true)
  vi.spyOn(workspace, 'nestFor').mockResolvedValue(undefined)
  const tab = await openOnline()
  if (!tab) throw new Error('no tab')
  const { renameTerminal } = await import('../rename')

  await renameTerminal(tab, 'Claude Code')
  expect(tab.name).toBe('Claude Code')
  expect(written).toEqual([])
  expect(await workspace.save(tab, '/mine')).toBe('/mine/Claude Code.term')
})

test('made for an agent, lands where it is told, behind, the same tab a person gets', async () => {
  inFront('/mine')
  const opened = vi.spyOn(workspace, 'openUnsaved')

  const tab = await madeOnline('n1', false)
  expect(opened).toHaveBeenCalledWith('terminal', WORDS, 'Terminal', 'n1', false)
  expect(tab !== null && typeof tab !== 'string' && isOnlineTab(tab)).toBe(true)
})
