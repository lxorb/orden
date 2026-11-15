import { expect, test, vi } from 'vitest'

const notes: Record<string, string> = {}

vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    if (command === 'path_exists') return Promise.resolve(path in notes)
    if (command !== 'read_note') return Promise.resolve(undefined)
    const doc = notes[path]
    return doc === undefined ? Promise.reject(new Error(`no ${path}`)) : Promise.resolve(doc)
  },
}))

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())

vi.mock('./tree', () => ({
  entryIn: () => Promise.resolve({ path: '/space/Finance/Bank.url', is_dir: false }),
  moveFile: vi.fn(),
  treeOf: vi.fn(),
}))
const lent: unknown[] = []
const { workspace } = await import('../../workspace/src/workspace.svelte')
await import('../../workspace-ports')
const { providePort } = await import('@orden/contracts')
providePort('web.lending', {
  lend: (tab: string, as: unknown) => {
    lent.push({ tab, as })
    return Promise.resolve()
  },
  unlend: () => undefined,
  readerStore: () => Promise.resolve(null),
  adopt: (_tab: string, handing: () => unknown) => handing(),
} as never)
const { writeShortcut } = await import('@orden/scan/shortcut')
const { callerOf } = await import('../../automation/src/api')
const { noteBehind, protection } = await import('../../protect/src/api')
const LOCKED = '/space/Finance/Bank.url'
vi.spyOn(protection, 'agentsMay').mockImplementation(
  (path) => !String(path).startsWith('/space/Finance'),
)
vi.spyOn(protection, 'locked').mockImplementation((path) =>
  String(path).startsWith('/space/Finance'),
)
const { workspaceTabs } = await import('./tabs')
const { answerTheCrate } = await import('./crate')

test('a copy of a locked web note made by a split stays behind its lock, for the reader and for agents', async () => {
  workspace.collapsePanes()
  workspace.tabs = []
  workspace.spaces = [{ id: 'one', name: 'One', root: '/space' }]
  workspace.activeSpaceId = 'one'
  notes[LOCKED] = writeShortcut(
    'https://bank.example/account?session=s3cret',
    'Bank',
    new Date(),
    null,
    null,
    '3f9a0c17e2b4d685',
  )
  const caller = callerOf({
    id: 'x',
    name: 'X',
    scopes: ['workspace', 'workspace.focus', 'browser.reader'],
    spaces: ['One'],
    mode: 'unsupervised',
  })
  await workspaceTabs({
    verb: 'workspace_tabs',
    caller,
    args: { op: 'open', path: 'Finance/Bank.url' },
  })
  const locked = workspace.tabs.find((one) => one.path === LOCKED)
  expect(locked).toBeDefined()

  const split = await workspaceTabs({
    verb: 'workspace_tabs',
    caller,
    args: { op: 'split', tab: locked?.id },
  })
  const copy = workspace.tabs.find((one) => one.id !== locked?.id && one.kind === 'web')
  expect(copy?.path).toBeNull()
  expect(protection.locked(noteBehind(copy ?? { kind: 'web', path: null }))).toBe(true)
  expect(JSON.stringify(split)).not.toContain('s3cret')
  expect(await answerTheCrate('agent.reader_tabs', {})).toEqual([])
  await answerTheCrate('agent.lend', { tab: copy?.id })
  expect(lent).toEqual([])
})
