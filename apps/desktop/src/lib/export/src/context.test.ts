import { describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  active: null as { doc: string; name: string; path: string | null; note: object } | null,
  trusts: true,
  asked: 0,
}))

vi.mock('../../workspace/src/api', () => ({
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
vi.mock('../../theme/src/theme.svelte', () => ({
  theme: { accent: 'violet', active: { path: null } },
}))
vi.mock('../../modes/src/api', () => ({
  modes: { codeTheme: 'auto' },
  choices: { page: undefined, exportAppearance: 'light' },
}))
vi.mock('../../link-index/src/api', () => ({
  links: {
    embedSource: () => null,
    fileFor: (src: string) => (src === 'attachments/cat.png' ? '/space/attachments/cat.png' : null),
    relativeTarget: () => null,
    spaceRead: () => Promise.resolve(),
  },
}))
vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  imagePath: () => null,
}))
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

  test('find a picture where the note shows it, and leave one nowhere as written', async () => {
    world.active = open('/space/Notes/Day/plan.md')
    const { resolveImage } = await renderOptions(openTarget())

    expect(resolveImage?.('attachments/cat.png')).toBe('/space/attachments/cat.png')
    expect(resolveImage?.('gone.png')).toBe('gone.png')
  })

  test('leave it markup when it is the reader’s own', async () => {
    world.active = open('Notes/plan.md')
    world.trusts = true

    expect((await renderOptions(openTarget())).escapeHtml).toBe(false)
  })
})
