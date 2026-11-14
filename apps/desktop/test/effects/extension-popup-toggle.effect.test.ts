import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const asked: { command: string; args: Record<string, unknown> | undefined }[] = []
let built = 0

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    asked.push({ command, args })
    if (command === 'extensions_list')
      return Promise.resolve(
        ['a', 'b'].map((id) => ({
          id,
          version: '1.0',
          name: id,
          popup: 'popup.html',
          action: true,
        })),
      )
    if (command === 'extension_popup_open')
      return Promise.resolve(`web-extension-popup-${String(built++)}`)
    return Promise.resolve(undefined)
  },
}))

const { overlays } = await import('../../src/lib/ui-kit/src/overlays')
const { extensions } = await import('../../src/lib/web-tab/extensions.svelte')
const ExtensionBar = (await import('./ExtensionBar.svelte')).default

let target: HTMLElement
let bar: ReturnType<typeof mount>

const onDown = (event: Event) => overlays.pressed(event)
const onClick = (event: Event) => overlays.clicked(event)

function button(id: string): HTMLElement {
  const found = target.querySelector<HTMLElement>(`[data-extension="${id}"]`)
  if (!found) throw new Error(`no button for ${id}`)
  return found
}

const later = async () => {
  await new Promise((done) => setTimeout(done, 0))
  flushSync()
}

async function press(on: Element, pointer = true) {
  if (pointer) {
    on.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await later()
    on.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  }
  on.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await later()
}

const popups = () => target.querySelectorAll('.popup').length
const opened = () => asked.filter((one) => one.command === 'extension_popup_open')

beforeEach(async () => {
  target = document.body.appendChild(document.createElement('div'))
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('click', onClick, true)
  await extensions.load()
  bar = mount(ExtensionBar, { target })
  flushSync()
  asked.length = 0
})

afterEach(() => {
  extensions.close()
  flushSync()
  void unmount(bar)
  document.removeEventListener('pointerdown', onDown, true)
  document.removeEventListener('click', onClick, true)
  target.remove()
})

test('a second press on the button closes its popup, and it does not open again', async () => {
  await press(button('a'))
  expect(extensions.popped?.id).toBe('a')
  expect(popups()).toBe(1)

  await press(button('a'))
  expect(extensions.popped).toBeNull()
  expect(popups()).toBe(0)
  expect(opened()).toHaveLength(1)
  expect(overlays.depth).toBe(0)

  await press(button('a'))
  expect(extensions.popped?.id).toBe('a')
  expect(opened()).toHaveLength(2)
})

test('so does Enter or Space on it', async () => {
  await press(button('a'), false)
  expect(extensions.popped?.id).toBe('a')
  await press(button('a'), false)
  expect(extensions.popped).toBeNull()
  expect(opened()).toHaveLength(1)
})

test.each([true, false])(
  "another extension's button closes the first and opens only its own (pointer: %s)",
  async (pointer) => {
    await press(button('a'), pointer)
    await press(button('b'), pointer)
    expect(extensions.popped?.id).toBe('b')
    expect(opened().map((one) => one.args?.id)).toEqual(['a', 'b'])
    for (let round = 0; round < 10 && popups() > 1; round++) await later()
    expect(popups()).toBe(1)
    expect(overlays.depth).toBe(1)
    const shown = `web-extension-popup-${String(built - 1)}`
    const last = opened().at(-1)
    const after = last ? asked.slice(asked.indexOf(last) + 1) : []
    for (const one of after.filter((each) => each.command === 'extension_popup_close')) {
      expect(one.args?.label).toBeDefined()
      expect(one.args?.label).not.toBe(shown)
    }
  },
)

test('Escape, a press elsewhere and the tab going close it, and the focus leaving does not', async () => {
  await press(button('a'))
  overlays.away()
  expect(extensions.popped?.id).toBe('a')

  const inside = target.querySelector('.popup .inside')
  if (!inside) throw new Error('no popup')
  await press(inside)
  expect(extensions.popped?.id).toBe('a')

  overlays.escape()
  flushSync()
  expect(extensions.popped).toBeNull()

  await press(button('a'))
  await press(document.body.appendChild(document.createElement('p')))
  expect(extensions.popped).toBeNull()

  await press(button('a'))
  extensions.close()
  flushSync()
  expect(popups()).toBe(0)
  expect(asked.filter((one) => one.command === 'extension_popup_close').length).toBeGreaterThan(0)
})
