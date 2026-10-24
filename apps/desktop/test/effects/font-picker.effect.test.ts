/** A face picked from the families installed, or typed, and said to be missing where it
 *  is not installed (#772). */

import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const installed = vi.hoisted(() => new Set(['DejaVu Sans', 'DejaVu Sans Mono', 'Inter']))

vi.mock('../../src/lib/font-families', async (original) => ({
  ...(await original<typeof import('../../src/lib/font-families')>()),
  installedFamilies: () =>
    Promise.resolve([
      { name: 'DejaVu Sans', mono: false },
      { name: 'DejaVu Sans Mono', mono: true },
      { name: 'Inter', mono: false },
    ]),
  isInstalled: (name: string) => !name || installed.has(name),
}))

/** jsdom lays nothing out, so has nothing to scroll a row into view of. */
Element.prototype.scrollIntoView = () => undefined

const FontPicker = (await import('../../src/lib/settings/FontPicker.svelte')).default

let target: HTMLElement
let app: ReturnType<typeof mount>
let chosen: string[] = []
let value = ''

function picker(mono: boolean, start = '') {
  value = start
  app = mount(FontPicker, {
    target,
    props: {
      get value() {
        return value
      },
      placeholder: 'iA Writer Quattro',
      mono,
      label: 'Note font',
      onchange: (family: string) => {
        chosen.push(family)
        value = family
      },
    },
  })
  flushSync()
}

const field = () => target.querySelector('input')!
const rows = () =>
  [...target.querySelectorAll('[role=option]')].map((one) => one.textContent.trim())

async function opened() {
  field().focus()
  field().dispatchEvent(new FocusEvent('focus'))
  await tick()
  await Promise.resolve()
  flushSync()
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  chosen = []
})

afterEach(() => {
  void unmount(app)
  target.remove()
})

test('lists the families installed, each set in its own face', async () => {
  picker(false)
  await opened()
  expect(rows()).toEqual(['DejaVu Sans', 'DejaVu Sans Mono', 'Inter'])
  const first = target.querySelector<HTMLElement>('[role=option]')!
  expect(first.style.fontFamily).toContain('DejaVu Sans')
})

test('lists the monospaced ones first for code', async () => {
  picker(true)
  await opened()
  expect(rows()[0]).toBe('DejaVu Sans Mono')
})

test('narrows as it is typed, and takes a row with the arrows and Enter', async () => {
  picker(false)
  await opened()
  field().value = 'inte'
  field().dispatchEvent(new InputEvent('input', { bubbles: true }))
  flushSync()
  expect(rows()).toEqual(['Inter'])
  field().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  flushSync()
  expect(chosen).toEqual(['Inter'])
  expect(rows()).toEqual([])
})

test('takes a name typed that is in no list', async () => {
  picker(false)
  await opened()
  field().value = 'Comic Neue'
  field().dispatchEvent(new InputEvent('input', { bubbles: true }))
  field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  flushSync()
  expect(chosen).toEqual(['Comic Neue'])
})

test('says a face is not installed where this machine does not draw it', () => {
  picker(false, 'Comic Neue')
  expect(target.textContent).toContain('Not installed on this device')
  expect(field().getAttribute('aria-invalid')).toBe('true')
})

test('says nothing under a face that is installed, or under the app’s own', () => {
  picker(false, 'Inter')
  expect(target.textContent).not.toContain('Not installed')
})
