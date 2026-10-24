import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The import sheet while a space somebody shared with this account to be read is
 *  open, or one of the spaces there are (B280). An import written there would stop the
 *  copy here being the space's, and the sync refuses it on every pass: so the sheet
 *  lands where the reader may write, and does not offer that space as a place. */

const readOnly = new Set<string>()
vi.mock('./sharing.svelte', () => ({
  canWriteAt: (path: string) =>
    ![...readOnly].some((root) => path === root || path.startsWith(`${root}/`)),
}))

const THEIRS = { id: 'theirs', name: 'Theirs', root: '/theirs' }
const MINE = { id: 'mine', name: 'Mine', root: '/mine' }

const held = vi.hoisted((): { active: unknown } => ({ active: null }))
vi.mock('./workspace.svelte', () => ({
  workspace: {
    spaces: [THEIRS, MINE],
    get activeSpace() {
      return held.active
    },
    tree: {
      name: 'Theirs',
      path: '/theirs',
      is_dir: true,
      children: [{ name: 'Plans', path: '/theirs/Plans', is_dir: true, children: [] }],
    },
  },
}))

vi.mock('./surfaces.svelte', () => ({ importSheet: { ask: () => Promise.resolve() } }))

/** The places the picker offered, by id. */
const offered: string[] = []
vi.mock('./prompt.svelte', () => ({
  prompt: {
    find: (asked: { options: { id: string }[] }) => {
      offered.push(...asked.options.map((one) => one.id))
      return Promise.resolve(null)
    },
  },
}))

const { importing } = await import('./importing.svelte')

beforeEach(() => {
  readOnly.clear()
  readOnly.add(THEIRS.root)
  offered.length = 0
  held.active = THEIRS
  importing.root = null
  importing.forget()
})

describe('an import while a space shared to be read is open', () => {
  test("lands in the reader's own space instead", () => {
    importing.show()
    expect(importing.root).toBe(MINE.root)
  })

  test('lands nowhere where every space is one shared to be read', () => {
    readOnly.add(MINE.root)
    importing.show()
    expect(importing.root).toBeNull()
  })

  test('still lands in the open space where it is the reader’s own', () => {
    held.active = MINE
    importing.show()
    expect(importing.root).toBe(MINE.root)
  })

  test('is not offered that space as a place, from a space of the reader’s own', async () => {
    held.active = MINE
    await importing.chooseTarget()
    expect(offered).not.toContain(THEIRS.root)
    expect(offered.some((id) => id.startsWith(`${THEIRS.root}/`))).toBe(false)
  })
})
