import { beforeEach, describe, expect, test, vi } from 'vitest'
import { callerOf } from '../../automation/src/api'
import type { TrashItem } from '../../trash/src/api'

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
const restored: string[] = []
const items: TrashItem[] = []
vi.mock('../../trash/src/api', () => ({
  trash: {
    items,
    error: null,
    load: async () => undefined,
    restorable: () => true,
    restore: async (item: TrashItem) => void restored.push(item.id),
  },
}))
vi.mock('../../workspace/src/api', () => ({
  workspace: { spaces: [{ root: '/s/Work', name: 'Work' }] },
}))
vi.mock('../../agent-verbs/src/api', async (original) => ({
  ...(await original<typeof import('../../agent-verbs/src/api')>()),
  reachable: () => [{ root: '/s/Work', name: 'Work' }],
  asked: async () => null,
}))
const { recentlyDeleted } = await import('./deleted')
const device = (id: string, from: string): TrashItem => ({
  id: `device:${id}`,
  ref: id,
  kind: 'note',
  name: from.split('/').pop() ?? from,
  detail: from.slice(0, from.lastIndexOf('/')),
  deletedAt: 1,
  purgeAt: 2,
  source: 'device',
  from,
})
const account = (id: string, path: string): TrashItem => ({
  id: `note:${id}`,
  ref: id,
  kind: 'note',
  name: path.split('/').pop() ?? path,
  detail: ['Work', ...path.split('/').slice(0, -1)].join(' / '),
  deletedAt: 1,
  purgeAt: 2,
  source: 'account',
  note: { spaceId: 'w1', path },
})
function putBack(id: string) {
  return recentlyDeleted({
    verb: 'recently_deleted',
    args: { op: 'restore', id },
    caller: callerOf({ id: 'claude', name: 'Claude', scopes: ['tree'], mode: 'unsupervised' }),
  })
}
const bury = (buried: Record<string, Record<string, string>>) =>
  localStorage.setItem('orden:protected-buried', JSON.stringify(buried))
beforeEach(() => {
  localStorage.clear()
  restored.length = 0
  items.length = 0
})
describe('an agent putting back what was deleted', () => {
  test('cannot put back a locked note, whose lock would come back after it', async () => {
    items.push(device('t1', 'Work/Diary.md'))
    bury({ t1: { '': 'password' } })
    await expect(putBack('device:t1')).rejects.toMatchObject({ code: 'protected' })
    expect(restored).toEqual([])
  })
  test('cannot put back a note that went with a locked folder', async () => {
    items.push(account('n1', 'Private/Deep/Diary.md'))
    bury({ '/s/Work\nPrivate\nb1': { '': 'device' } })
    await expect(putBack('note:n1')).rejects.toMatchObject({ code: 'protected' })
    expect(restored).toEqual([])
  })
  test('puts back what no lock waits for', async () => {
    items.push(device('t2', 'Work/Plan.md'), account('n2', 'Open/Note.md'))
    bury({ t9: { '': 'password' }, '/s/Work\nPrivate\nb1': { '': 'device' } })
    await putBack('device:t2')
    await putBack('note:n2')
    expect(restored).toEqual(['device:t2', 'note:n2'])
  })
})
