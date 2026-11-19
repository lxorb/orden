import { beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

const world = vi.hoisted(() => ({
  saved: [] as unknown[],
  failing: false,
  refusing: false,
  user: null as { id: string } | null,
  token: null as string | null,
  leaving: [] as (() => void)[],
  unowned: [] as (() => void)[],
}))

vi.mock('../../accounts/src/account.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../accounts/src/account.svelte')>()),
  account: {
    get user() {
      return world.user
    },
    get noAccountForSure() {
      return world.token === null
    },
    get accountToken() {
      return world.user ? 'token' : null
    },
    forgetWithSession: (clear: () => void) => void world.leaving.push(clear),
    holdsNoAccount: (clear: () => void) => void world.unowned.push(clear),
  },
}))

vi.mock('../../accounts/src/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../accounts/src/client')>()
  return {
    ...original,
    api: {
      saveSettings: (_token: string, patch: unknown) => {
        world.saved.push(patch)
        if (world.refusing) return Promise.reject(new original.ApiError(413, 'too big'))
        return world.failing ? Promise.reject(new Error('offline')) : Promise.resolve({ settings: {} })
      },
    },
  }
})

vi.stubGlobal('localStorage', memoryStorage())

function signedOut() {
  for (const clear of world.leaving) clear()
  world.user = null
  world.token = null
}

async function relaunched() {
  vi.resetModules()
  world.leaving = []
  world.unowned = []
  const [{ shortcuts }, { toolbar }] = await Promise.all([import('./shortcuts.svelte'), import('./toolbar.svelte')])
  shortcuts.restore()
  toolbar.restore()
  return { shortcuts, toolbar }
}

const settled = () => new Promise((done) => setTimeout(done, 0))

beforeEach(() => {
  localStorage.clear()
  world.saved = []
  world.failing = false
  world.refusing = false
  world.user = { id: 'u1' }
  world.token = 'token'
})

describe('a shortcut changed while the account could not hear it', () => {
  test('outlives a relaunch, wins over the account and is sent again', async () => {
    const first = await relaunched()
    world.failing = true
    first.shortcuts.set('format.bold', 'Mod-Alt-j')
    await settled()

    world.failing = false
    world.saved = []
    const { shortcuts } = await relaunched()
    shortcuts.receive({ shortcuts: {} })
    await settled()

    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-j')
    expect(world.saved.at(-1)).toMatchObject({ shortcuts: { 'format.bold': 'Mod-Alt-j' } })

    shortcuts.receive({ shortcuts: { 'format.italic': 'Mod-Alt-k' } })
    expect(shortcuts.keyFor('format.italic')).toBe('Mod-Alt-k')
  })

  test('changed while the answer was on its way is not undone by it', async () => {
    const { shortcuts } = await relaunched()
    shortcuts.set('format.bold', 'Mod-Alt-j')
    shortcuts.receive({ shortcuts: {} })
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-j')
  })

  test('is not pressed on another account', async () => {
    const first = await relaunched()
    world.failing = true
    first.shortcuts.set('format.bold', 'Mod-Alt-j')
    await settled()

    world.failing = false
    world.user = { id: 'u2' }
    const { shortcuts } = await relaunched()
    shortcuts.receive({ shortcuts: { 'format.bold': 'Mod-Alt-b' } })
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-b')
  })
})

describe('a shortcut changed before the account is known', () => {
  test('is not undone once it is', async () => {
    world.user = null
    const { shortcuts } = await relaunched()
    shortcuts.set('format.bold', 'Mod-Alt-j')

    world.user = { id: 'u1' }
    shortcuts.receive({ shortcuts: {} })
    await settled()
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-j')
    expect(world.saved.at(-1)).toMatchObject({ shortcuts: { 'format.bold': 'Mod-Alt-j' } })
  })

  test('keeps a change owed to an account across a launch that does not know it yet', async () => {
    const first = await relaunched()
    world.failing = true
    first.shortcuts.set('format.bold', 'Mod-Alt-j')
    await settled()

    world.failing = false
    world.user = null
    const { shortcuts } = await relaunched()
    shortcuts.set('format.italic', 'Mod-Alt-k')
    world.user = { id: 'u1' }
    shortcuts.receive({ shortcuts: {} })
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-j')
    expect(shortcuts.keyFor('format.italic')).toBe('Mod-Alt-k')
  })
})

describe('a shortcut the account turned down', () => {
  test('is owed no longer, so the account is heard again', async () => {
    const { shortcuts } = await relaunched()
    world.refusing = true
    shortcuts.set('format.bold', 'Mod-Alt-j')
    await settled()
    world.refusing = false

    shortcuts.receive({ shortcuts: { 'format.bold': 'Mod-Alt-b' } })
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-b')
  })
})

describe('signing out', () => {
  test('leaves nothing owed for the next account, nor for the one that left', async () => {
    const { shortcuts } = await relaunched()
    world.failing = true
    shortcuts.set('format.bold', 'Mod-Alt-j')
    await settled()
    world.failing = false

    signedOut()
    world.user = { id: 'u2' }
    shortcuts.receive({ shortcuts: { 'format.italic': 'Mod-Alt-q' } })
    signedOut()
    world.saved = []
    world.user = { id: 'u1' }
    shortcuts.receive({ shortcuts: { 'format.bold': 'Mod-Alt-j' } })
    await settled()

    expect(world.saved).toEqual([])
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-j')
  })
})

describe('a shortcut changed while the session is read, in a session with no account', () => {
  test('is not sent over the account signed in to later', async () => {
    world.user = null
    const { shortcuts } = await relaunched()
    shortcuts.set('format.italic', 'Mod-Alt-k')
    for (const clear of world.unowned) clear()

    world.user = { id: 'u1' }
    world.saved = []
    shortcuts.receive({ shortcuts: { 'format.bold': 'Mod-Alt-b' } })
    await settled()

    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-b')
    expect(world.saved).toEqual([])
  })
})

describe('a shortcut changed while signed out', () => {
  test('stays on this device, and the account’s own are taken at the next sign-in', async () => {
    signedOut()
    const { shortcuts } = await relaunched()
    shortcuts.set('format.italic', 'Mod-Alt-k')

    world.token = 'token'
    world.user = { id: 'u1' }
    world.saved = []
    shortcuts.receive({ shortcuts: { 'format.bold': 'Mod-Alt-b' } })
    await settled()

    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-b')
    expect(world.saved).toEqual([])
  })
})

describe('a toolbar changed while the account could not hear it', () => {
  test('outlives a relaunch, wins over the account and is sent again', async () => {
    const first = await relaunched()
    world.failing = true
    first.toolbar.add('paragraph.task-list')
    await settled()

    world.failing = false
    world.saved = []
    const { toolbar } = await relaunched()
    toolbar.receive({ toolbar: null })
    await settled()

    expect(toolbar.ids.at(-1)).toBe('paragraph.task-list')
    expect(world.saved.at(-1)).toMatchObject({
      toolbar: expect.arrayContaining(['paragraph.task-list']),
    })
  })
})
