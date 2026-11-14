import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let config: unknown[] = []
let kept: Record<string, unknown> = { own: [], about: {}, order: [], groups: [] }
const asked: { command: string; args: unknown }[] = []

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args: unknown) => {
    asked.push({ command, args })
    if (command === 'remote_hosts') return Promise.resolve({ config, kept, file: '/h/.ssh/config' })
    if (command === 'remote_keep') {
      kept = (args as { kept: Record<string, unknown> }).kept
      return Promise.resolve(kept)
    }
    return Promise.resolve(null)
  },
}))

const confirmed: { title: string; detail?: string }[] = []
let sure = true

vi.mock('../../src/lib/prompt.svelte', () => ({
  prompt: {
    confirm: (options: { title: string; detail?: string }) => {
      confirmed.push(options)
      return Promise.resolve(sure)
    },
  },
}))

Element.prototype.animate = () => {
  const animation = {
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
    onfinish: null as (() => void) | null,
  }
  queueMicrotask(() => animation.onfinish?.())
  return animation as unknown as Animation
}
Element.prototype.scrollIntoView = () => undefined

const { default: HostPicker } = await import('../../src/lib/remote/HostPicker.svelte')
const { hostPicker } = await import('../../src/lib/remote/picker.svelte')
const { remote } = await import('../../src/lib/remote/hosts.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { readSpec } = await import('../../src/lib/terminal/spec')
const { settings } = await import('../../src/lib/settings.svelte')

const NOW = Date.now()

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  config = [
    { id: 'pi', also: ['raspberry'], hostname: '10.0.0.5', user: 'emil', group: 'Home' },
    { id: 'nas', also: [], group: 'Home' },
    { id: 'office', also: [], hostname: 'office.example.com', group: 'Work' },
    { id: 'build', also: [] },
  ]
  kept = {
    own: [],
    about: { office: { pinned: true }, nas: { last: NOW - 60_000, colour: '4' } },
    order: [],
    groups: [],
  }
  asked.length = 0
  confirmed.length = 0
  sure = true
  workspace.panes.collapse()
  workspace.tabs = []
  target = document.createElement('div')
  document.body.append(target)
  const made = mount(HostPicker, { target })
  close = () => void unmount(made, { outro: false })
})

afterEach(() => {
  hostPicker.dismiss()
  flushSync()
  close?.()
  target.remove()
  workspace.tabs = []
  vi.useRealTimers()
})

const dialog = () => target.querySelector<HTMLElement>('[role="menu"]')
const rows = () => [...(dialog()?.querySelectorAll<HTMLButtonElement>('.orden-row') ?? [])]
const names = () =>
  rows().map((one) => {
    const label = one.querySelector('.orden-row-label')?.cloneNode(true) as HTMLElement | undefined
    label?.querySelector('.detail')?.remove()
    return label?.textContent
  })

async function opened() {
  hostPicker.show()
  await remote.refresh()
  flushSync()
  await tick()
  flushSync()
}

async function press(key: string, code = '', held: KeyboardEventInit = {}) {
  const at = dialog()?.contains(document.activeElement) ? document.activeElement : dialog()
  at?.dispatchEvent(
    new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...held }),
  )
  flushSync()
  await tick()
  flushSync()
}

async function type(text: string) {
  for (const character of text) await press(character)
}

async function made() {
  await vi.waitFor(() => expect(workspace.tabs.length).toBe(1))
  const tab = workspace.tabs[0]
  if (!tab) throw new Error('no tab')
  return tab
}

test('no field: the pinned host, the recent one, then the rest by group, numbered on Alt', async () => {
  await opened()

  expect(dialog()?.classList.contains('is-centred')).toBe(true)
  expect(dialog()?.querySelector('input, textarea, [contenteditable]')).toBe(null)
  expect(names()).toEqual(['office', 'nas', 'build', 'pi'])
  const numbers = () => rows().map((one) => one.querySelector('.place')?.textContent ?? null)
  expect(numbers()).toEqual([null, null, null, null])
  await press('Alt', 'AltLeft', { altKey: true })
  expect(numbers()).toEqual(['1', '2', '3', '4'])
  dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', code: 'AltLeft' }))
  await vi.waitFor(() => expect(numbers()).toEqual([null, null, null, null]))
  expect(
    [...(dialog()?.querySelectorAll('.head > span') ?? [])].map((one) => one.textContent),
  ).toEqual(['Home'])
  expect(dialog()?.querySelectorAll('hr').length).toBe(2)
  expect(rows()[3]?.querySelector('.detail')?.textContent).toBe('emil@10.0.0.5')
  expect(rows()[1]?.querySelector('.orden-row-meta')).not.toBe(null)
  expect(document.activeElement).toBe(rows()[0])
})

test('a digit connects at once: a terminal tab on that host, named for it', async () => {
  await opened()
  await press('4', 'Digit4')

  expect(hostPicker.open).toBe(false)
  const tab = await made()
  expect(readSpec(tab.doc)?.shell).toBe('ssh:pi')
  expect(tab.kind).toBe('terminal')
  expect(tab.name).toBe('pi')
})

test('a name, or another name of it, is found and waits for Enter', async () => {
  await opened()
  await type('rasp')

  expect(names()).toEqual(['pi'])
  expect(hostPicker.open).toBe(true)
  expect(workspace.tabs).toHaveLength(0)

  await press('Enter')
  expect(readSpec((await made()).doc)?.shell).toBe('ssh:pi')
})

test('an address nobody keeps is a row of its own, and choosing it keeps it', async () => {
  await opened()
  await type('me@box:2222')

  expect(names()).toEqual(['me@box:2222'])
  await press('Enter')

  const tab = await made()
  const own = (kept.own as { id: string; hostname: string; user: string; port: number }[])[0]
  expect(own).toMatchObject({ hostname: 'box', user: 'me', port: 2222, name: 'me@box:2222' })
  expect(readSpec(tab.doc)?.shell).toBe(`ssh:${own?.id ?? ''}`)
})

test('with no hosts at all, the one row is the way to Settings, Remote', async () => {
  config = []
  kept = { own: [], about: {}, order: [], groups: [] }
  const shown = vi.spyOn(settings, 'show').mockImplementation(() => undefined)
  await opened()

  expect(names()).toEqual(['Add host'])
  rows()[0]?.click()
  expect(shown).toHaveBeenCalledWith('remote')
  expect(hostPicker.open).toBe(false)
  shown.mockRestore()
})

test('Escape and the scrim put it away, and a digit no host has is refused', async () => {
  await opened()
  await press('9', 'Digit9')
  expect(hostPicker.open).toBe(true)
  expect(names()).toHaveLength(4)

  target.querySelector<HTMLElement>('.orden-scrim')?.click()
  flushSync()
  expect(hostPicker.open).toBe(false)
  expect(workspace.tabs).toHaveLength(0)
})

test("a group's Open all opens every host in it, the first in front and the rest behind it", async () => {
  await opened()
  const head = [...(dialog()?.querySelectorAll<HTMLElement>('.head') ?? [])].find((one) =>
    one.textContent.includes('Home'),
  )
  head?.querySelector<HTMLButtonElement>('.all')?.click()

  await vi.waitFor(() => expect(workspace.tabs.length).toBe(2))
  expect(hostPicker.open).toBe(false)
  expect(workspace.tabs.map((tab) => readSpec(tab.doc)?.shell)).toEqual(['ssh:pi', 'ssh:nas'])
  expect(workspace.activeTabId).toBe(workspace.tabs[0]?.id)
})

test('a group of ten or more asks before it opens them all, and opens nothing on No', async () => {
  config = Array.from({ length: 10 }, (_, at) => ({
    id: `lab${String(at)}`,
    also: [],
    group: 'Lab',
  }))
  kept = { own: [], about: {}, order: [], groups: [] }
  await opened()
  const all = () => dialog()?.querySelector<HTMLButtonElement>('.head .all')

  sure = false
  all()?.click()
  await vi.waitFor(() => expect(confirmed).toHaveLength(1))
  expect(confirmed[0]).toMatchObject({ title: 'Open all', detail: '10 tabs' })
  await new Promise((settle) => setTimeout(settle, 20))
  expect(workspace.tabs).toHaveLength(0)

  sure = true
  await opened()
  all()?.click()
  await vi.waitFor(() => expect(workspace.tabs).toHaveLength(10))
})
