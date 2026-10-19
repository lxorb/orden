import { beforeEach, describe, expect, test, vi } from 'vitest'

/** When the window is a guest's one shared file and nothing else (#386): only for
 *  somebody with no account, only for a link to one file, and only while that file
 *  is in front of them - or on its way. */

const world = vi.hoisted(() => ({
  user: null as { id: string } | null,
  guest: null as { id: string; name: string } | null,
  spaces: [] as { id: string }[],
  invitation: null as { note: string | null } | null,
  active: null as { note: { shared?: string } } | null,
}))

vi.mock('./account.svelte', () => ({
  account: {
    get user() {
      return world.user
    },
    get guest() {
      return world.guest
    },
    get spaces() {
      return world.spaces
    },
  },
}))

vi.mock('./joining.svelte', () => ({
  joining: {
    get invitation() {
      return world.invitation
    },
  },
}))

vi.mock('./workspace.svelte', () => ({
  workspace: {
    get active() {
      return world.active
    },
    panes: { focusedId: 'pane-1' },
  },
}))

const { alone } = await import('./alone.svelte')

beforeEach(() => {
  world.user = null
  world.guest = null
  world.spaces = []
  world.invitation = null
  world.active = null
})

const guest = { id: 'g1', name: 'Windows wren' }
const sharedCanvas = { note: { shared: 'note-1' } }

describe('a guest a link gave one file to', () => {
  test('has the window to itself while the file is in front', () => {
    world.guest = guest
    world.active = sharedCanvas

    expect(alone.on).toBe(true)
    expect(alone.pane).toBe('pane-1')
  })

  test('and while the link to it is still being walked through', () => {
    world.invitation = { note: 'board.canvas' }

    expect(alone.on).toBe(true)
  })

  test('gets the app back in front of anything that is not that file', () => {
    world.guest = guest
    world.active = { note: {} }

    expect(alone.on).toBe(false)
    expect(alone.pane).toBeNull()
  })
})

describe('everybody else keeps the app round the file', () => {
  test('an account, whatever it opened', () => {
    world.user = { id: 'u1' }
    world.active = sharedCanvas
    world.invitation = { note: 'board.canvas' }

    expect(alone.on).toBe(false)
  })

  test('a guest a link let into a whole space', () => {
    world.guest = guest
    world.spaces = [{ id: 'space-1' }]
    world.active = sharedCanvas

    expect(alone.on).toBe(false)
  })

  test('a link to a space, on its way', () => {
    world.invitation = { note: null }

    expect(alone.on).toBe(false)
  })
})
