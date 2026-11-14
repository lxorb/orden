import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { overlays } from '../../src/lib/overlays'
import SidebarFoot from '../../src/lib/SidebarFoot.svelte'
import { settings } from '../../src/lib/settings.svelte'
import { theme } from '../../src/lib/theme/src/theme.svelte'
import { store } from '../../src/lib/theme-looks/src/gallery/store.svelte'
import { picking, pickTheme } from '../../src/lib/theme-looks/src/picker/picking.svelte'
import { workspace } from '../../src/lib/workspace.svelte'
import '../../src/lib/theme-ports'

await Promise.all([
  import('@orden/themes/glass'),
  import('../../src/lib/theme-looks/src/api'),
  import('../../src/lib/theme-looks/src/glass/settings'),
  import('../../src/lib/theme-looks/src/glass/follow.svelte'),
  import('../../src/lib/theme-looks/src/wallpaper/sheet'),
  import('../../src/lib/theme-looks/src/wallpaper/settings'),
  import('../../src/lib/theme-looks/src/wallpaper/wallpaper.svelte'),
  import('../../src/lib/theme/src/material'),
  import('../../src/lib/theme/src/declared'),
  import('../../src/lib/theme-looks/src/picker/ThemePicker.svelte'),
  import('@orden/themes/tokens.css?raw'),
])

Element.prototype.scrollIntoView = () => undefined

class NoLayout {
  observe() {
    // Nothing to measure.
  }

  unobserve() {
    // Nothing to measure.
  }

  disconnect() {
    // Nothing to measure.
  }
}

globalThis.ResizeObserver = NoLayout

const ROSE = {
  id: 'file:rose',
  name: 'Rose',
  path: '/themes/rose.css',
  variants: ['light' as const, 'dark' as const],
  css: "[data-theme='light'] { --bg: #fff0f3; }\n[data-theme='dark'] { --bg: #2b1119; }",
  ownAccent: false,
}

const root = document.documentElement
const sheet = () => document.getElementById('orden-user-theme')?.textContent ?? ''

const storage = () =>
  Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, at) => localStorage.key(at) ?? '').map(
      (name) => [name, localStorage.getItem(name)],
    ),
  )

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const cards = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
const card = (name: string) => cards().find((one) => one.textContent.includes(name))
const grid = () => document.querySelector<HTMLElement>('[role="listbox"]')
const field = () => dialog()?.querySelector('input') ?? null

function pointAt(element: Element | undefined) {
  if (!element) throw new Error('nothing there to point at')
  element.dispatchEvent(new Event('pointermove', { bubbles: true }))
  flushSync()
}

function leave(element: Element | null) {
  if (!element) throw new Error('nothing there to leave')
  element.dispatchEvent(new Event('pointerleave'))
  flushSync()
}

function press(key: string) {
  const input = field()
  if (!input) throw new Error('the picker has no field')
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  flushSync()
}

async function opened() {
  pickTheme()
  flushSync()
  await tick()
  flushSync()
}

beforeEach(() => {
  workspace.restored = true
  localStorage.clear()
  theme.files = [ROSE]
  theme.select('default')
  theme.setScheme('dark')
  theme.setAccent('violet')
  localStorage.clear()
})

afterEach(() => {
  picking.close()
  flushSync()
  settings.open = false
  store.close()
})

test('the themes button in the sidebar foot opens it over itself, in place of a light and dark switch', async () => {
  const target = document.createElement('div')
  document.body.append(target)
  const foot = mount(SidebarFoot, { target })
  flushSync()

  expect(target.querySelector('[aria-label="Light"], [aria-label="Dark"]')).toBeNull()
  const button = target.querySelector<HTMLElement>('[aria-label="Themes"]')
  button?.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 200, clientY: 700 }),
  )
  await expect.poll(() => picking.open).toBe(true)
  flushSync()

  expect(dialog()).not.toBeNull()
  expect(picking.at?.x).toBe(200)
  expect(theme.current).toBe('dark')

  void unmount(foot, { outro: false })
  target.remove()
})

const DRIVE = readFileSync(resolve('../../scripts/drive_scheme.py'), 'utf8')

function driven(name: string): string {
  const found = new RegExp(`^${name} = "(.*)"$`, 'm').exec(DRIVE)?.[1]
  if (!found) throw new Error(`drive_scheme.py names no ${name}`)
  return found
}

function modeOf(scheme: 'light' | 'dark'): string {
  const names = JSON.parse(/^NAMES = (\{.*\})$/m.exec(DRIVE)?.[1] ?? '{}') as Record<string, string>
  const shape = /def mode\(scheme\):\n\s+return f"(.*)"/.exec(DRIVE)?.[1] ?? ''
  return shape.replace('{PICKER}', driven('PICKER')).replace('{NAMES[scheme]}', names[scheme] ?? '')
}

test('the native drives switch the scheme through the button and the choices drawn here', async () => {
  const target = document.createElement('div')
  document.body.append(target)
  const foot = mount(SidebarFoot, { target })
  flushSync()

  for (const scheme of ['light', 'dark'] as const) {
    const button = document.querySelector<HTMLElement>(driven('THEMES'))
    expect(button, 'the drives press a themes button the foot no longer draws').not.toBeNull()
    button?.click()
    await expect.poll(() => picking.open).toBe(true)
    flushSync()
    expect(document.querySelector(driven('PICKER'))).not.toBeNull()

    const choice = [...document.querySelectorAll<HTMLElement>(modeOf(scheme))].at(-1) ?? null
    expect(
      choice,
      `the drives choose ${scheme} with a control the picker no longer draws`,
    ).not.toBeNull()
    choice?.click()
    flushSync()
    expect(root.dataset.theme).toBe(scheme)

    expect(overlays.escape()).toBe(true)
    flushSync()
    expect(picking.open).toBe(false)
  }

  void unmount(foot, { outro: false })
  target.remove()
})

test('the palette’s row opens it where the palette stands', async () => {
  const { appCommands } = await import('../../src/lib/commands')
  const row = appCommands().find((one) => one.id === 'themes')
  expect(row?.label).toBe('Switch theme')

  row?.run()
  await expect.poll(() => picking.open).toBe(true)
  expect(picking.at).toBeNull()
})

test('shows every theme as a card, with the store last', async () => {
  await opened()

  const names = cards().map((one) => one.textContent.trim())
  expect(names).toEqual(['Classic', 'Contrast', 'Glass', 'Wallpaper', 'Rose', 'Browse'])
})

test('pointing at a theme puts it on the app and writes nothing down', async () => {
  await opened()
  const before = storage()

  pointAt(card('Rose'))

  expect(theme.id).toBe('file:rose')
  expect(root.dataset.theme).toBe('dark')
  expect(sheet()).toContain('#2b1119')
  expect(storage()).toEqual(before)
})

test('moving off the cards gives the kept one back', async () => {
  await opened()

  pointAt(card('Contrast'))
  expect(theme.id).toBe('contrast')

  leave(grid())
  expect(theme.id).toBe('default')
  expect(sheet()).toBe('')
  expect(picking.open).toBe(true)
})

test('turns see-through while a theme is tried, all but the card pointed at, and solid again after', async () => {
  await opened()
  expect(dialog()?.dataset.seeing).toBeUndefined()

  pointAt(card('Rose'))
  expect(dialog()?.dataset.seeing).toBe('id')
  expect(card('Rose')?.classList.contains('is-on')).toBe(true)

  leave(grid())
  expect(dialog()?.dataset.seeing).toBeUndefined()

  press('ArrowRight')
  expect(dialog()?.dataset.seeing).toBe('id')
  expect(theme.id).not.toBe('default')
  expect(overlays.escape()).toBe(true)
  flushSync()
  expect(theme.id).toBe('default')
})

test('Escape closes it and gives back exactly what was there', async () => {
  await opened()

  pointAt(card('Rose'))
  pointAt(document.querySelector('[aria-label="Light"][aria-pressed]') ?? undefined)
  pointAt(document.querySelector('[aria-label="Teal"]') ?? undefined)
  expect(theme.accent).toBe('teal')

  expect(overlays.escape()).toBe(true)
  flushSync()

  expect(picking.open).toBe(false)
  expect(theme.id).toBe('default')
  expect(theme.scheme).toBe('dark')
  expect(theme.accent).toBe('violet')
  expect(root.dataset.theme).toBe('dark')
  expect(localStorage.getItem('orden:theme')).toBeNull()
})

test('a press outside does the same', async () => {
  await opened()
  pointAt(card('Rose'))

  document.querySelector<HTMLElement>('.orden-scrim')?.click()
  flushSync()

  expect(picking.open).toBe(false)
  expect(theme.id).toBe('default')
})

test('a click keeps the theme, written down as Settings writes it, and closes', async () => {
  await opened()

  pointAt(card('Rose'))
  card('Rose')?.click()
  flushSync()

  expect(picking.open).toBe(false)
  expect(theme.id).toBe('file:rose')
  expect(localStorage.getItem('orden:theme')).toBe('file:rose')
  expect(sheet()).toContain('#2b1119')
})

test('the arrows try each theme in turn, and Enter keeps the one they are on', async () => {
  await opened()

  press('ArrowRight')
  expect(theme.id).toBe('contrast')
  press('ArrowRight')
  expect(theme.id).toBe('glass')
  press('ArrowRight')
  expect(theme.id).toBe('wallpaper')
  press('ArrowRight')
  expect(theme.id).toBe('file:rose')
  press('ArrowDown')
  expect(theme.id).toBe('default')
  press('ArrowUp')
  expect(theme.id).toBe('glass')
  expect(localStorage.getItem('orden:theme')).toBeNull()

  press('Enter')
  expect(picking.open).toBe(false)
  expect(localStorage.getItem('orden:theme')).toBe('glass')
})

test('typing narrows the cards and tries the first that answers', async () => {
  await opened()
  const input = field()
  if (!input) throw new Error('the picker has no field')

  input.value = 'ros'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()

  expect(cards().map((one) => one.textContent.trim())).toEqual(['Rose', 'Browse'])
  expect(theme.id).toBe('file:rose')
})

test('a word nothing answers to is looked for in the store', async () => {
  await opened()
  const input = field()
  if (!input) throw new Error('the picker has no field')

  input.value = 'dracula'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  press('Enter')

  expect(picking.open).toBe(false)
  expect(theme.id).toBe('default')
  expect(settings.open).toBe(true)
  expect(settings.section).toBe('appearance')
  expect(store.open).toBe(true)
  expect(store.query).toBe('dracula')
})

test('the scheme and the accent are tried the same way and kept with a click', async () => {
  await opened()

  const light = [...document.querySelectorAll<HTMLElement>('[role="radiogroup"] button')].find(
    (one) => one.getAttribute('aria-label') === 'Light',
  )
  pointAt(light)
  expect(root.dataset.theme).toBe('light')
  expect(localStorage.getItem('orden:theme-scheme')).toBeNull()

  light?.click()
  flushSync()
  expect(localStorage.getItem('orden:theme-scheme')).toBe('light')
  expect(picking.open).toBe(true)

  const keptAccent = () =>
    (
      JSON.parse(localStorage.getItem('orden:theme-settings') ?? '{}') as Record<
        string,
        Record<string, unknown> | undefined
      >
    )['*']?.accent

  const teal = document.querySelector<HTMLElement>('[aria-label="Teal"]')
  pointAt(teal ?? undefined)
  expect(theme.accent).toBe('teal')
  expect(keptAccent()).toBeUndefined()
  teal?.click()
  flushSync()
  expect(keptAccent()).toBe('teal')

  expect(overlays.escape()).toBe(true)
  flushSync()
  expect(theme.scheme).toBe('light')
  expect(theme.accent).toBe('teal')
})

test('draws the wallpaper with the picture the window would wear, and tries it on the app', async () => {
  const picture = 'data:image/png;base64,iVBORw0KGgo='
  localStorage.setItem(
    'orden:wallpaper',
    JSON.stringify({
      picture,
      blur: 28,
      dark: { floor: 0.55, ground: '#202630' },
      light: { floor: 0.5, ground: '#e9ecf2' },
    }),
  )
  theme.rewear('wallpaper')
  await opened()

  await expect
    .poll(() =>
      card('Wallpaper')
        ?.querySelector<HTMLElement>('.window')
        ?.style.getPropertyValue('--mini-picture'),
    )
    .toBe(`url("${picture}")`)
  expect(card('Wallpaper')?.querySelector('.mini')?.classList.contains('pictured')).toBe(true)

  pointAt(card('Wallpaper'))
  await expect.poll(sheet).toContain(`--wallpaper-picture: url("${picture}")`)
  expect(localStorage.getItem('orden:theme')).toBeNull()

  leave(grid())
  await expect.poll(() => theme.id).toBe('default')
})
