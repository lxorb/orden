import { beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

const sent: { command: string; args: Record<string, unknown> }[] = []

let listed: { name: string; path: string }[] = []
let refuses = false
let reading: (() => void) | null = null
let filtering: (() => void) | null = null
let theirs = new Set<string>()
const who = vi.hoisted(() => ({ user: null as { id: string } | null }))

vi.mock('../../platform/src/tauri', () => ({
  isNative: false,
  invoke: (command: string, args?: Record<string, unknown>) => {
    sent.push({ command, args: args ?? {} })

    if (command === 'list_spaces') {
      const shown = [...listed]
      reading?.()
      return Promise.resolve(shown)
    }
    if (refuses) return Promise.reject(new Error('the disk said no'))

    if (command === 'create_space') {
      const wanted = typeof args?.name === 'string' ? args.name : ''
      let name = wanted
      for (let count = 2; listed.some((one) => one.name === name); count += 1) {
        name = `${wanted} ${count}`
      }
      return Promise.resolve({ name, path: `/spaces/${name}` })
    }

    if (command === 'rename_space') {
      const name = typeof args?.name === 'string' ? args.name : ''
      return Promise.resolve({ name, path: `/spaces/${name}` })
    }

    return Promise.resolve('')
  },
}))

vi.mock('../../accounts/src/account.svelte', () => ({
  account: {
    signedIn: false,
    get user() {
      return who.user
    },
  },
}))

vi.mock('../../left-spaces/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../left-spaces/src/api')>()),
  leftByAnother: (root: string) => {
    const now = filtering
    filtering = null
    now?.()
    return theirs.has(root)
  },
}))

vi.stubGlobal('localStorage', memoryStorage())

const { applySpaceOrder, loadSpaces, moveSpace } = await import('./spaces')
const { keepHomes } = await import('../../left-spaces/src/api')
const { adoptSpace, deleteSpace, renameSpace } = await import('./space-changes')
type HoldsSpaces = import('./spaces').HoldsSpaces
type Space = import('./workspace.svelte').Space

function store(spaces: Space[]) {
  const told: string[] = []

  const ws = {
    spaces: spaces.map((one) => ({ ...one })),
    activeSpaceId: spaces[0]?.id ?? null,
    tree: null,
    naming: { path: '/spaces/Work', appending: false, making: null },
    panel: null,
    notes: [],
    tabs: [],
    fileMoved: async (from: string, to: string, kind: string) =>
      void told.push(`moved ${kind} ${from} -> ${to}`),
    fileGone: async (path: string, kind: string) => void told.push(`gone ${kind} ${path}`),
    holdingUnder: (_path: string, run: () => Promise<void>) => run(),
    close: (id: string) => void told.push(`closed ${id}`),
    clearSelection: () => undefined,
    loadTree: () => Promise.resolve(),
    persist: () => undefined,
  }

  return { ws: ws as unknown as HoldsSpaces, told }
}

const WORK = { id: 'w', name: 'Work', root: '/spaces/Work' }
const HOME = { id: 'h', name: 'Home', root: '/spaces/Home' }

beforeEach(() => {
  sent.length = 0
  listed = []
  refuses = false
  reading = null
  filtering = null
  theirs = new Set()
  who.user = null
  localStorage.clear()
})

describe('reading the spaces folder', () => {
  test('keeps the id of a space that is already known', async () => {
    const { ws } = store([WORK, HOME])
    listed = [
      { name: 'Home', path: '/spaces/Home' },
      { name: 'Work', path: '/spaces/Work' },
    ]
    await loadSpaces(ws)
    expect(ws.spaces.map((one) => one.id)).toEqual(['w', 'h'])
    expect(ws.activeSpaceId).toBe('w')
  })

  test('and a space that is new to this machine gets an id and goes last', async () => {
    const { ws } = store([WORK])
    listed = [
      { name: 'Ideas', path: '/spaces/Ideas' },
      { name: 'Work', path: '/spaces/Work' },
    ]
    await loadSpaces(ws)
    expect(ws.spaces.map((one) => one.name)).toEqual(['Work', 'Ideas'])
    expect(ws.spaces[1]?.id).toBeTruthy()
  })

  test('and a space that has gone leaves the open one settled on what is left', async () => {
    const { ws } = store([WORK, HOME])
    ws.activeSpaceId = 'h'
    listed = [{ name: 'Work', path: '/spaces/Work' }]
    await loadSpaces(ws)
    expect(ws.spaces.map((one) => one.id)).toEqual(['w'])
    expect(ws.activeSpaceId).toBe('w')
  })

  test('and none at all leaves nothing open', async () => {
    const { ws } = store([WORK])
    await loadSpaces(ws)
    expect(ws.spaces).toEqual([])
    expect(ws.activeSpaceId).toBeNull()
  })
})

describe('the spaces folder read while a space comes or goes', () => {
  const TEAM = { id: 't', name: 'Team', root: '/spaces/Team' }

  test('keeps a space that came in while the listing was being sorted out', async () => {
    who.user = { id: 'emil' }
    const { ws } = store([WORK])
    listed = [{ name: 'Work', path: '/spaces/Work' }]
    filtering = () => {
      listed = [...listed, { name: 'Team', path: TEAM.root }]
      ws.spaces = [...ws.spaces, { ...TEAM }]
    }
    await loadSpaces(ws)
    expect(ws.spaces.map((one) => one.root)).toEqual(['/spaces/Work', '/spaces/Team'])
    expect(ws.spaces[1]?.id).toBe('t')
  })

  test('keeps the space made during the last of every read that came too late', async () => {
    const { ws } = store([WORK])
    listed = [{ name: 'Work', path: '/spaces/Work' }]
    const made = ['A', 'B', 'C']
    reading = () => {
      const name = made.shift()
      if (!name) return
      listed = [...listed, { name, path: `/spaces/${name}` }]
      ws.spaces = [...ws.spaces, { id: name, name, root: `/spaces/${name}` }]
    }
    await loadSpaces(ws)
    expect(ws.spaces.map((one) => one.name)).toEqual(['Work', 'A', 'B', 'C'])
  })

  test('does not bring back a space that went while the listing was being sorted out', async () => {
    who.user = { id: 'emil' }
    const { ws } = store([WORK, HOME])
    listed = [
      { name: 'Home', path: '/spaces/Home' },
      { name: 'Work', path: '/spaces/Work' },
    ]
    filtering = () => {
      listed = listed.filter((one) => one.name !== 'Home')
      ws.spaces = ws.spaces.filter((one) => one.id !== 'h')
    }
    await loadSpaces(ws)
    expect(ws.spaces.map((one) => one.id)).toEqual(['w'])
  })

  test('takes a space renamed meanwhile under its new name only', async () => {
    who.user = { id: 'emil' }
    const { ws } = store([WORK, TEAM])
    listed = [
      { name: 'Team', path: TEAM.root },
      { name: 'Work', path: '/spaces/Work' },
    ]
    filtering = () => {
      ws.spaces = ws.spaces.map((one) =>
        one.id === 't' ? { ...one, name: 'Crew', root: '/spaces/Crew' } : one,
      )
    }
    await loadSpaces(ws)
    expect(ws.spaces.map((one) => one.root)).toEqual(['/spaces/Work', '/spaces/Crew'])
  })
})

describe('the order the switcher shows', () => {
  test('takes the account’s, and says it moved', () => {
    const { ws } = store([WORK, HOME])
    expect(applySpaceOrder(ws, [HOME.root, WORK.root])).toBe(true)
    expect(ws.spaces.map((one) => one.name)).toEqual(['Home', 'Work'])
  })

  test('and stays quiet where the account says what is already on show', () => {
    const { ws } = store([WORK, HOME])
    expect(applySpaceOrder(ws, [WORK.root, HOME.root])).toBe(false)
  })

  test('and keeps the place of a space the account has never heard of', () => {
    const { ws } = store([WORK, HOME, { id: 'l', name: 'Local', root: '/spaces/Local' }])
    applySpaceOrder(ws, [HOME.root, WORK.root])
    expect(ws.spaces.map((one) => one.name)).toEqual(['Home', 'Work', 'Local'])
  })

  test('a drag that ends where it started is quiet', () => {
    const { ws } = store([WORK, HOME])
    expect(moveSpace(ws, 'w', 'h')).toBe(false)
    expect(moveSpace(ws, 'w', 'w')).toBe(false)
  })

  test('and a drag to the end moves it', () => {
    const { ws } = store([WORK, HOME])
    expect(moveSpace(ws, 'w', null)).toBe(true)
    expect(ws.spaces.map((one) => one.id)).toEqual(['h', 'w'])
  })
})

describe('a space renamed', () => {
  test('takes everything kept under its root with it', async () => {
    const { ws, told } = store([WORK])
    await renameSpace(ws, 'w', 'Studio')
    expect(ws.spaces[0]).toEqual({ id: 'w', name: 'Studio', root: '/spaces/Studio' })
    expect(told).toEqual(['moved space /spaces/Work -> /spaces/Studio'])
  })

  test('and the field it was typed in is done with, whatever the folder answers', async () => {
    const { ws } = store([WORK])
    refuses = true
    await renameSpace(ws, 'w', 'Studio')
    expect(ws.naming).toBeNull()
    expect(ws.spaces[0]?.name).toBe('Work')
  })

  test('and a name of nothing at all is not a rename', async () => {
    const { ws } = store([WORK])
    await renameSpace(ws, 'w', '   ')
    expect(sent).toEqual([])
    expect(ws.spaces[0]?.name).toBe('Work')
  })
})

describe('a space deleted', () => {
  test('is said once, as a space that went, and the next one opens', async () => {
    const { ws, told } = store([WORK, HOME])
    await deleteSpace(ws, 'w')
    expect(ws.spaces.map((one) => one.id)).toEqual(['h'])
    expect(told).toEqual(['gone space /spaces/Work'])
    expect(ws.activeSpaceId).toBe('h')
  })

  test('goes to this device’s trash while there is no account to keep it', async () => {
    const { ws } = store([WORK])
    await deleteSpace(ws, 'w')
    expect(sent.map((one) => one.command)).toEqual(['trash_item'])
  })

  test('and a folder that will not go leaves the list alone', async () => {
    const { ws } = store([WORK, HOME])
    refuses = true
    await deleteSpace(ws, 'w')
    expect(ws.spaces.map((one) => one.id)).toEqual(['w', 'h'])
  })
})

describe('a space of the account taken in', () => {
  test('lands in the folder of its name the window has not listed yet, not in a copy beside it', async () => {
    const { ws } = store([])
    listed = [{ name: 'Notes', path: '/spaces/Notes' }]
    const root = await adoptSpace(ws, 'Notes')
    expect(root).toBe('/spaces/Notes')
    expect(sent.map((one) => one.command)).not.toContain('create_space')
    expect(ws.spaces.map((one) => one.root)).toEqual(['/spaces/Notes'])
  })

  test('but not in one another account left on this device', async () => {
    const { ws } = store([])
    listed = [{ name: 'Notes', path: '/spaces/Notes' }]
    theirs = new Set(['/spaces/Notes'])
    expect(await adoptSpace(ws, 'Notes')).toBe('/spaces/Notes 2')
  })

  test('and one asked for beside a space of the same name gets a folder of its own', async () => {
    const { ws } = store([])
    listed = [{ name: 'Notes', path: '/spaces/Notes' }]
    expect(await adoptSpace(ws, 'Notes', true)).toBe('/spaces/Notes 2')
  })
})

describe('a space somebody shared taken in afresh', () => {
  test('lands in the folder this device remembers it in, not in a numbered copy', async () => {
    who.user = { id: 'a' }
    keepHomes('a', [{ root: '/spaces/Team', spaceId: 'shared-team' }])
    const { ws } = store([])
    listed = [{ name: 'Team', path: '/spaces/Team' }]
    expect(await adoptSpace(ws, 'Team', true, 'shared-team')).toBe('/spaces/Team')
    expect(sent.map((one) => one.command)).not.toContain('create_space')
  })

  test('but not in a folder of that name remembered for another space', async () => {
    who.user = { id: 'a' }
    keepHomes('a', [{ root: '/spaces/Team', spaceId: 'mine' }])
    const { ws } = store([])
    listed = [{ name: 'Team', path: '/spaces/Team' }]
    expect(await adoptSpace(ws, 'Team', true, 'shared-team')).toBe('/spaces/Team 2')
  })

  test('nor in one remembered for it by another account', async () => {
    who.user = { id: 'b' }
    keepHomes('a', [{ root: '/spaces/Team', spaceId: 'shared-team' }])
    const { ws } = store([])
    listed = [{ name: 'Team', path: '/spaces/Team' }]
    expect(await adoptSpace(ws, 'Team', true, 'shared-team')).toBe('/spaces/Team 2')
  })
})
