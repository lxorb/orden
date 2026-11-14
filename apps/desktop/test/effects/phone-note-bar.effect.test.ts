import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'

const { workspace } = await import('../../src/lib/workspace.svelte')
const { viewport } = await import('../../src/lib/ui-kit/src/viewport.svelte')
const { menu } = await import('../../src/lib/menu.svelte')
const { default: Titlebar } = await import('../../src/lib/Titlebar.svelte')
const { showNoteMore } = await (await import('../../src/lib/phone/src/api')).noteMore()

afterEach(() => {
  viewport.device = 'desktop'
  menu.open = false
  document.body.replaceChildren()
})

function bar() {
  workspace.spaces = [{ id: 'work', name: 'Work', root: '/spaces/Work' }]
  workspace.activeSpaceId = 'work'
  workspace.tabs = []
  workspace.openBlank('Kestrel', '# Kestrel\n\nA bird.\n')
  workspace.closePanel()
  const host = document.createElement('div')
  document.body.append(host)
  const shown = mount(Titlebar, { target: host, props: { onpalette: () => undefined } })
  flushSync()
  return { host, done: () => void unmount(shown, { outro: false }) }
}

test("a phone's note bar has one More button in place of the search and the side's toggle", () => {
  viewport.device = 'phone'
  const { host, done } = bar()
  try {
    expect(host.querySelector('header [data-phone-more]')).not.toBeNull()
    expect(host.querySelector('header .search')).toBeNull()
    expect(host.querySelector('header [data-side-toggle="right"]')).toBeNull()
  } finally {
    done()
  }

  viewport.device = 'tablet'
  const tablet = bar()
  try {
    expect(tablet.host.querySelector('header [data-phone-more]')).toBeNull()
    expect(tablet.host.querySelector('header .search')).not.toBeNull()
  } finally {
    tablet.done()
  }
})

test('and its menu holds the outline, the links, the history and the tab, each once', () => {
  viewport.device = 'phone'
  const { host, done } = bar()
  try {
    showNoteMore(host.querySelector<HTMLButtonElement>('header [data-phone-more]')!)
    expect(menu.open).toBe(true)
    const labels = menu.items.flatMap((one) => (one ? [one.label] : []))

    expect(labels.slice(0, 2)).toEqual(['Outline', 'Links'])
    expect(labels).toContain('Version history')
    expect(new Set(labels).size).toBe(labels.length)
    expect(menu.title).toBe('Kestrel')

    menu.items.find((one) => one?.label === 'Outline')?.run()
    expect(workspace.openOn('right')).toBe('outline')
  } finally {
    workspace.closeRight()
    done()
  }
})
