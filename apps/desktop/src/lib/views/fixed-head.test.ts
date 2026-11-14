import { readBase } from '@orden/bases'
import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../sharing/src/api', () => ({
  canWriteAt: (path: string) => !path.startsWith('/theirs'),
  trustsHtmlAt: () => true,
}))

const { kitFor } = await import('./kit')
const { contextFor } = await import('./context')
const { default: ViewHead } = await import('./ViewHead.svelte')
const { columnMenu } = await import('./column-menu')

function kitOf(fixed: boolean, path: string | null, rows = 'notes') {
  const base = readBase('views:\n  - type: table\n    name: One\n  - type: table\n    name: Two\n')
  const live = {
    base,
    at: 0,
    today: '2026-10-24',
    context: contextFor({ rows: [], today: '2026-10-24', now: '2026-10-24T12:00' }),
    view: { ...base.views[0], orden: { rows } },
    rows: [],
    writtenAt: path,
    fixed,
    locked: false,
    refused: 0,
    typed: '',
    builder: null,
    change: () => Promise.resolve(),
  }
  return kitFor(live as unknown as Parameters<typeof kitFor>[0], {}, null, true)
}

const head = (kit: ReturnType<typeof kitOf>) =>
  render(ViewHead, { props: { kit, title: 'Base', onadd: () => undefined } }).body

describe('a view whose base cannot be kept', () => {
  test('offers no column menu: all of it changes the base', () => {
    expect(columnMenu(kitOf(true, '/mine/a.md'), 'file.name', ['file.name'])).toEqual([])
    expect(columnMenu(kitOf(false, '/mine/a.md'), 'file.name', ['file.name'])).not.toEqual([])
  })

  test('can still add a note', () => {
    const kit = kitOf(true, '/mine/a.md')
    expect(kit.writable).toBe(false)
    expect(kit.adds).toBe(true)
    expect(head(kit)).toContain('aria-label="New note"')
  })

  test('offers nothing that changes the view, and still its tabs', () => {
    const html = head(kitOf(true, '/mine/a.md'))
    for (const label of ['New view', 'Filter', 'Sort', 'Settings', 'Display']) {
      expect(html).not.toContain(`aria-label="${label}"`)
    }
    expect(html).toContain('One')
    expect(html).toContain('Two')
  })

  test('where it can be kept, offers all of it', () => {
    const html = head(kitOf(false, '/mine/a.md'))
    for (const label of ['New view', 'Filter', 'Sort', 'Settings', 'New note']) {
      expect(html).toContain(`aria-label="${label}"`)
    }
  })

  test('in a space shared to be read adds nothing either', () => {
    const kit = kitOf(false, '/theirs/a.md')
    expect(kit.writable).toBe(false)
    expect(kit.adds).toBe(false)
    expect(head(kit)).not.toContain('aria-label="New view"')
  })
})
