import { afterEach, describe, expect, test, vi } from 'vitest'

vi.stubGlobal('localStorage', {
  length: 0,
  key: () => null,
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
})

const sent = vi.hoisted(() => [] as [string, string][])
vi.mock('../api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api')>()
  return {
    ...original,
    api: new Proxy(original.api, {
      get: (target, key) =>
        key === 'renameSpace'
          ? (_token: string, id: string, name: string) => {
              sent.push([id, name])
              return Promise.resolve({ space: { id, name } })
            }
          : Reflect.get(target, key),
    }),
  }
})

const { runner } = await import('./runner.svelte')
const { account } = await import('../account.svelte')
const { workspace } = await import('../workspace.svelte')

interface Open {
  current: unknown
  local: boolean
}

const open = runner as unknown as Open

function engineWith(root: string) {
  const space = { id: 's1', row: { root, role: 'owner' } }
  return {
    core: {
      spaces: new Map([['s1', space]]),
      rootMoved: (_id: string, to: string) => {
        space.row = { ...space.row, root: to }
        return []
      },
      commit: () => Promise.resolve(),
    },
  }
}

async function renamed(role: string) {
  sent.length = 0
  vi.spyOn(account, 'loadSpaces').mockResolvedValue(undefined as never)
  account.token = 'session'
  account.spaces = [{ id: 's1', name: 'Work', role }] as never
  workspace.spaces = [{ id: 'local', name: 'Job', root: '/spaces/Job' }]
  open.local = false
  open.current = engineWith('/spaces/Work')

  await runner.follow({ op: 'moved', kind: 'space', from: '/spaces/Work', to: '/spaces/Job' })
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
  return sent
}

afterEach(() => {
  open.current = null
  vi.restoreAllMocks()
})

describe('a space renamed on this device', () => {
  test('takes its new name to the account', async () => {
    expect(await renamed('owner')).toEqual([['s1', 'Job']])
  })

  test('but not one somebody else owns', async () => {
    expect(await renamed('write')).toEqual([])
  })
})
