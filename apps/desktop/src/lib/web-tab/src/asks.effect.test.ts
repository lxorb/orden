import { flushSync, mount, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'

const asked: { command: string; args: Record<string, unknown> }[] = []
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    asked.push({ command, args })
    return Promise.resolve(undefined)
  },
}))
const { asked: asks, readMenu, readSelect } = await import('./asked.svelte')
const { pages } = await import('./pages.svelte')
const { menu, overlays } = await import('../../ui-kit/src/api')
const WebAsks = (await import('./WebAsks.svelte')).default
const { settle } = await import('../../../../test/effects/settle')
Object.assign(Element.prototype, {
  animate() {
    const one = {
      onfinish: null as (() => void) | null,
      oncancel: null,
      currentTime: 0,
      playState: 'running',
      cancel: () => undefined,
      finish: () => one.onfinish?.(),
      play: () => undefined,
      pause: () => undefined,
      effect: null,
      finished: Promise.resolve(),
    }
    setTimeout(() => one.onfinish?.(), 0)
    return one
  },
})
test('a page’s select closes cleanly, and the page’s menu after it opens as Orden’s', async () => {
  Object.assign(pages.of('t'), {
    sent: { pane: { x: 0, y: 40, width: 800, height: 560 }, visible: true, frame: null, cut: null },
  })
  const target = document.createElement('div')
  document.body.append(target)
  const app = mount(WebAsks, { target, props: { tab: 't' } })
  const select = readSelect({
    tab: 't',
    id: 1,
    x: 20,
    y: 20,
    width: 220,
    height: 36,
    zoom: 1,
    selected: 0,
    options: [
      { index: 0, label: 'Apple', disabled: false, group: null },
      { index: 1, label: 'Banana', disabled: false, group: null },
    ],
  })
  if (!select) throw new Error('no select')
  asks.heardSelect(select)
  flushSync()
  expect(target.querySelector('[role="listbox"]')).not.toBeNull()
  const shown = asks.selectOf('t')
  if (!shown) throw new Error('no select shown')
  asks.pickSelect(shown, 1)
  expect(() => flushSync()).not.toThrow()
  await settle()
  expect(asked.at(-1)).toEqual({ command: 'web_select_pick', args: { tab: 't', id: 1, index: 1 } })
  const said = readMenu({ tab: 't', id: 2, x: 30, y: 120, zoom: 1, link: 'https://example.com/', items: [] })
  if (!said) throw new Error('no menu')
  await asks.showMenu(said)
  expect(menu.open).toBe(true)
  menu.hide()
  void unmount(app)
  target.remove()
})
test('a page’s list closes on a press in the page, as Orden’s do, but not on the window giving the page back its focus from the press that opened it, and on Escape', async () => {
  Object.assign(pages.of('t'), {
    sent: { pane: { x: 0, y: 40, width: 800, height: 560 }, visible: true, frame: null, cut: null },
  })
  const target = document.createElement('div')
  document.body.append(target)
  const app = mount(WebAsks, { target, props: { tab: 't' } })
  const options = [{ index: 0, label: 'Apple', disabled: false, group: null }]
  for (const [id, close] of [
    [
      3,
      () => {
        dispatchEvent(new Event('blur'))
        flushSync()
        expect(asks.selectOf('t')).not.toBeNull()
        const later = performance.now() + 1000
        vi.spyOn(performance, 'now').mockReturnValue(later)
        overlays.away()
        flushSync()
        expect(asks.selectOf('t')).not.toBeNull()
        dispatchEvent(new Event('blur'))
        vi.restoreAllMocks()
      },
    ],
    [
      4,
      () =>
        target
          .querySelector('[role="listbox"]')
          ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    ],
  ] as const) {
    const select = readSelect({ tab: 't', id, x: 20, y: 20, width: 100, height: 30, zoom: 1, selected: 0, options })
    if (!select) throw new Error('no select')
    asks.heardSelect(select)
    flushSync()
    close()
    flushSync()
    await settle()
    expect(asks.selectOf('t')).toBeNull()
    expect(asked.at(-1)).toEqual({ command: 'web_select_pick', args: { tab: 't', id, index: null } })
  }
  void unmount(app)
  target.remove()
})
