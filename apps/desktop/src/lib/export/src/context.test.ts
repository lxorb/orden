import { describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  active: null as { doc: string; name: string; path: string | null; note: object } | null,
  trusts: true,
  asked: 0,
}))

vi.mock('../../workspace.svelte', () => ({
  workspace: {
    wordsNow: () => {
      world.asked += 1
    },
    get active() {
      return world.active
    },
    protection: { locked: () => false },
  },
}))
vi.mock('../../sharing/src/api', () => ({ trustsHtmlIn: () => world.trusts }))
vi.mock('../../settings.svelte', () => ({
  settings: { page: undefined, exportAppearance: 'light' },
}))
vi.mock('../../theme/src/theme.svelte', () => ({
  theme: { accent: 'violet', active: { path: null } },
}))
vi.mock('../../modes.svelte', () => ({ modes: { codeTheme: 'auto' } }))
vi.mock('../../link-index.svelte', () => ({
  links: {
    embedSource: () => null,
    relativeTarget: () => null,
    spaceRead: () => Promise.resolve(),
  },
}))
vi.mock('../../images', () => ({ imagePath: () => null }))
vi.mock('../../platform/src/tauri', () => ({ invoke: () => Promise.resolve(''), isNative: false }))

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
