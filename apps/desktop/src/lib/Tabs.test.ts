import { describe, expect, test, vi } from 'vitest'
import { render } from 'svelte/server'

const asked: string[] = []

vi.mock('./file-mark', async (importOriginal) => {
  const real = await importOriginal<typeof import('./file-mark')>()
  return {
    ...real,
    markOf: (kind: string) => {
      asked.push(`markOf ${kind}`)
      return real.markOf(kind as never)
    },
  }
})

vi.mock('./rooms.svelte', () => ({ rooms: { present: {}, seen: {}, following: null } }))

const { workspace } = await import('./workspace.svelte')
const Tabs = (await import('./Tabs.svelte')).default

function strip(count: number) {
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'

  for (let at = 0; at < count; at++) workspace.openBlank(`Note ${at}`, '# note')

  const paneId = workspace.tabs[0]?.paneId ?? ''
  for (const tab of workspace.tabs) {
    tab.paneId = paneId
  }

  if (workspace.tabsIn(paneId).length !== count) {
    throw new Error(`the strip holds ${workspace.tabsIn(paneId).length} of ${count} tabs`)
  }

  return paneId
}

describe('drawing the tab strip', () => {
  test('asks what mark a tab wears once per tab', () => {
    const paneId = strip(8)
    asked.length = 0

    const drawn = render(Tabs, { props: { paneId } })

    expect(drawn.body.split('data-tab=').length - 1).toBe(8)
    expect(asked).toHaveLength(8)
  })

  test('and so twice the tabs is twice the asking, and no more', () => {
    const paneId = strip(16)
    asked.length = 0

    const drawn = render(Tabs, { props: { paneId } })

    expect(drawn.body.split('data-tab=').length - 1).toBe(16)
    expect(asked).toHaveLength(16)
  })
})

describe('the tab in front', () => {
  test('is the one tab that says it is current', () => {
    const paneId = strip(3)
    const front = workspace.tabsIn(paneId)[1]?.id ?? ''
    workspace.activate(front)

    const html = render(Tabs, { props: { paneId } }).body
    const current = [...html.matchAll(/<button[^>]*aria-current="page"[^>]*>/g)]

    expect(current).toHaveLength(1)
    expect(current[0]?.[0]).toContain(`data-tab="${front}"`)
  })
})

describe("the strip's line", () => {
  test('runs its whole width while what is open is an essential, which is no tab of it', () => {
    const paneId = strip(2)
    const shown = workspace.tabs[0]
    if (!shown) throw new Error('no tab to show')
    shown.essential = '/space/Note 0.md'
    workspace.panes.activate(paneId, shown.id)

    const drawn = render(Tabs, { props: { paneId } })

    expect(drawn.body.split('data-tab=').length - 1).toBe(1)
    expect(drawn.body).toMatch(/class="tabs\b[^"]*\bbare\b/)
  })
})
