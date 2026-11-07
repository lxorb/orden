import { afterEach, describe, expect, test, vi } from 'vitest'

const { memoryStorage } = await import('../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())

const sent = vi.hoisted(() => [] as [string, string][])
const line = vi.hoisted(() => ({ up: true }))
vi.mock('../api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api')>()
  return {
    ...original,
    api: new Proxy(original.api, {
      get: (target, key) =>
        key === 'renameSpace'
          ? (_token: string, id: string, name: string) => {
              if (!line.up) return Promise.reject(new TypeError('Failed to fetch'))
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
const { settleNames } = await import('../space-owed')

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

async function renamed(role: string, shown = true) {
  sent.length = 0
  vi.spyOn(account, 'loadSpaces').mockResolvedValue(undefined as never)
  account.token = 'session'
  account.user = { id: 'u1' } as never
  account.spaces = [{ id: 's1', name: 'Work', role }] as never
  workspace.spaces = shown ? [{ id: 'local', name: 'Job', root: '/spaces/Job' }] : []
  open.local = false
  open.current = engineWith('/spaces/Work')

  await runner.follow({
    op: 'moved',
    kind: 'space',
    from: '/spaces/Work',
    to: '/spaces/Job',
    root: null,
  })
  await vi.dynamicImportSettled()
  for (let turn = 0; turn < 10; turn++) await Promise.resolve()
  return sent
}

afterEach(() => {
  line.up = true
  localStorage.clear()
  open.current = null
  vi.restoreAllMocks()
})

describe('a space renamed on this device', () => {
  test('takes its new name to the account', async () => {
    expect(await renamed('owner')).toEqual([['s1', 'Job']])
  })

  test('even where this window has not heard of the new folder yet', async () => {
    expect(await renamed('owner', false)).toEqual([['s1', 'Job']])
  })

  test('but not one somebody else owns', async () => {
    expect(await renamed('write')).toEqual([])
  })
})

test('a space renamed while the account is away sends its name once it answers', async () => {
  line.up = false
  expect(await renamed('owner')).toEqual([])

  line.up = true
  await settleNames('session', 'u1')

  expect(sent).toEqual([['s1', 'Job']])
  sent.length = 0
  await settleNames('session', 'u1')
  expect(sent).toEqual([])
})
