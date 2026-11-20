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
const { menu } = await import('../../ui-kit/src/api')
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
