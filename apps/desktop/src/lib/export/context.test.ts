import { describe, expect, test, vi } from 'vitest'

/** What a print and an export are handed about the open note. The app around it
 *  is stood in for: what is under test is that the trust question the reading
 *  view asks of a document is asked of it here too, rather than an export of a
 *  collaborator's note running their markup in a window of the app's own. */
const world = vi.hoisted(() => ({
  active: null as { doc: string; name: string; path: string | null; note: object } | null,
  trusts: true,
  asked: 0,
}))

vi.mock('../workspace.svelte', () => ({
  workspace: {
    wordsNow: () => {
      world.asked += 1
    },
    get active() {
      return world.active
    },
  },
}))
vi.mock('../sharing.svelte', () => ({ trustsHtmlIn: () => world.trusts }))
vi.mock('../settings.svelte', () => ({ settings: { page: undefined, exportAppearance: 'light' } }))
vi.mock('../theme.svelte', () => ({ theme: { accent: 'violet', active: { path: null } } }))
vi.mock('../modes.svelte', () => ({ modes: { codeTheme: 'auto' } }))
vi.mock('../link-index.svelte', () => ({
  links: {
    embedSource: () => null,
    relativeTarget: () => null,
    spaceRead: () => Promise.resolve(),
  },
}))
vi.mock('../images', () => ({ imagePath: () => null }))
vi.mock('../tauri', () => ({ invoke: () => Promise.resolve(''), isNative: false }))

const { openTarget, renderOptions } = await import('./context')

const open = (path: string | null) => ({ doc: '# Plan', name: 'Plan.md', path, note: {} })

describe('the open note', () => {
  test('is read after everything holding words of its own has handed them over', () => {
    world.active = open('Notes/plan.canvas')
    const before = world.asked

    openTarget()

    expect(world.asked).toBe(before + 1)
  })
})

describe('the render options for the open note', () => {
  test('show its HTML as characters when it is somebody else’s', async () => {
    world.active = open('Shared/plan.md')
    world.trusts = false

    expect((await renderOptions(openTarget())).escapeHtml).toBe(true)
  })

  test('leave it markup when it is the reader’s own', async () => {
    world.active = open('Notes/plan.md')
    world.trusts = true

    expect((await renderOptions(openTarget())).escapeHtml).toBe(false)
  })
})
