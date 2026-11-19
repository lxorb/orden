import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { defaultKeyFor } from '@orden/editor'
import { BY_ID, SHORTCUTS } from '../../shortcuts/src/api'
import type { Platform } from '../../ui-kit/src/api'
import { appKeyOf, appKeys, cameFromAfter, focusBeside, readLeft, readPressed } from './keys'

describe('a key out of a page', () => {
  test('is read as the crate sends it', () => {
    expect(
      readPressed({
        key: 't',
        code: 'KeyT',
        ctrl: true,
        shift: false,
        alt: false,
        repeat: false,
        down: true,
      }),
    ).toEqual({
      key: 't',
      code: 'KeyT',
      ctrl: true,
      shift: false,
      alt: false,
      meta: false,
      repeat: false,
      down: true,
    })
  })
  test('with Cmd held as Cmd', () => {
    expect(readPressed({ key: 'o', code: 'KeyO', meta: true, down: true })).toMatchObject({ meta: true, ctrl: false })
  })
  test('and a release is a release', () => {
    expect(readPressed({ key: 'Control', code: 'ControlLeft', down: false })).toMatchObject({
      key: 'Control',
      ctrl: false,
      down: false,
    })
  })
  test('holds nothing it was not told', () => {
    expect(readPressed({ key: 'w', code: 'KeyW', ctrl: 'yes', down: 1 })).toMatchObject({
      ctrl: false,
      down: false,
    })
  })
  test('and is nothing where the crate said nothing a key could be', () => {
    expect(readPressed(null)).toBeNull()
    expect(readPressed('t')).toBeNull()
    expect(readPressed({ key: '', code: 'KeyT' })).toBeNull()
    expect(readPressed({ key: 't' })).toBeNull()
  })
})

function tableOn(platform: Platform) {
  const keys = appKeys(
    SHORTCUTS,
    (id) => {
      const entry = BY_ID.get(id)
      return entry ? defaultKeyFor(entry, platform) : null
    },
    () => true,
    platform,
  )
  const named = (code: string, held: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}) =>
    keys.some(
      (one) =>
        one.code === code &&
        one.ctrl === (held.ctrl ?? false) &&
        one.shift === (held.shift ?? false) &&
        one.alt === (held.alt ?? false) &&
        one.meta === (held.meta ?? false),
    )
  return { keys, named }
}
describe('the keys a page hands the app', () => {
  test("are the app's own shortcuts, read from its table", () => {
    const { named } = tableOn('win')
    expect(named('KeyO', { ctrl: true })).toBe(true)
    expect(named('KeyP', { ctrl: true, shift: true })).toBe(true)
    expect(named('KeyT', { ctrl: true })).toBe(true)
    expect(named('KeyW', { ctrl: true })).toBe(true)
    expect(named('Tab', { ctrl: true })).toBe(true)
    expect(named('Digit1', { ctrl: true, alt: true })).toBe(true)
    expect(named('ArrowDown', { ctrl: true, alt: true })).toBe(true)
    expect(named('F11', { shift: true })).toBe(true)
    expect(named('KeyL', { ctrl: true, shift: true })).toBe(true)
    expect(named('F5')).toBe(true)
  })
  test('with Cmd for Mod on a Mac', () => {
    const { named } = tableOn('mac')
    expect(named('KeyO', { meta: true })).toBe(true)
    expect(named('KeyP', { meta: true, shift: true })).toBe(true)
    expect(named('Digit1', { meta: true })).toBe(true)
    expect(named('Tab', { ctrl: true })).toBe(true)
    expect(named('KeyF', { meta: true, ctrl: true, shift: true })).toBe(true)
    expect(named('KeyO', { ctrl: true })).toBe(false)
  })
  test('and leave the page its typing, its editing and the double taps', () => {
    const { keys, named } = tableOn('win')
    expect(named('KeyB', { ctrl: true })).toBe(false)
    expect(named('KeyC', { ctrl: true })).toBe(false)
    expect(named('KeyV', { ctrl: true })).toBe(false)
    expect(named('Escape')).toBe(false)
    expect(keys.every((one) => one.ctrl || one.alt || one.meta || /^F\d+$/.test(one.code))).toBe(true)
    expect(appKeyOf('Shift Shift', 'win')).toBeNull()
    expect(appKeyOf('Alt Alt', 'win')).toBeNull()
    expect(appKeyOf('q', 'win')).toBeNull()
    expect(appKeyOf('Shift-Tab', 'win')).toBeNull()
  })
  test('name the key by where it sits', () => {
    expect(appKeyOf('Mod-Shift-,', 'win')).toEqual({
      key: ',',
      code: 'Comma',
      ctrl: true,
      shift: true,
      alt: false,
      meta: false,
    })
    expect(appKeyOf('Mod-Space', 'mac')).toMatchObject({ key: ' ', code: 'Space', meta: true })
    expect(appKeyOf('Mod-Shift-/', 'linux')).toMatchObject({ code: 'Slash' })
    expect(appKeyOf('Mod-=', 'win')).toMatchObject({ code: 'Equal' })
  })
  test('each once', () => {
    const { keys } = tableOn('win')
    const named = keys.map((one) => `${one.code}:${one.ctrl}:${one.shift}:${one.alt}:${one.meta}`)
    expect(new Set(named).size).toBe(named.length)
  })
})
describe('the keyboard at the ends of a page', () => {
  const app = () =>
    new JSDOM('<button id="more">More</button><div id="slot" tabindex="0"></div><button id="next">Next</button>').window
      .document
  test('goes back to the control before the page as the page lets it go backwards', () => {
    const document = app()
    const slot = document.getElementById('slot')!
    expect(focusBeside(slot, false)?.id).toBe('more')
    expect(document.activeElement?.id).toBe('more')
  })
  test('and on to the control after it as the page lets it go forwards', () => {
    const document = app()
    const slot = document.getElementById('slot')!
    expect(focusBeside(slot, true)?.id).toBe('next')
  })
  test('passing over what cannot take it', () => {
    const document = new JSDOM(
      '<button id="first">First</button><button id="off" disabled>Off</button><div inert><button>Asleep</button></div><div id="slot" tabindex="0"></div>',
    ).window.document
    const slot = document.getElementById('slot')!
    expect(focusBeside(slot, false)?.id).toBe('first')
    expect(focusBeside(slot, true)).toBeNull()
  })
  test('comes into the page at its first stop from before it and its last from after it', () => {
    const document = app()
    const slot = document.getElementById('slot')!
    expect(cameFromAfter(slot, document.getElementById('more'))).toBe(false)
    expect(cameFromAfter(slot, document.getElementById('next'))).toBe(true)
    expect(cameFromAfter(slot, null)).toBe(false)
  })
  test("is told by the window with the page's tab and its way", () => {
    expect(readLeft({ tab: 'a-1', next: false })).toEqual({ tab: 'a-1', next: false })
    expect(readLeft({ tab: 'a-1' })).toBeNull()
    expect(readLeft({ next: true })).toBeNull()
  })
})
describe('the keyboard handed into a page', () => {
  const script = readFileSync(
    join(import.meta.dirname, '../../../../src-tauri/crates/web/src/keyboard_into.js'),
    'utf8',
  )
  const page = (body: string, last: boolean) => {
    const dom = new JSDOM(body, { runScripts: 'outside-only' })
    dom.window.eval(`globalThis.ordenIntoLast = ${last};\n${script}`)
    const now = dom.window.document.activeElement
    return now === dom.window.document.body ? 'the page' : (now?.id ?? null)
  }
  const body =
    '<a id="skip" href="#" tabindex="-1">Skip</a><input id="field"><button id="go">Go</button><button id="off" disabled>Off</button>'
  test('lands on its first stop coming forwards', () => {
    expect(page(body, false)).toBe('field')
  })
  test('and on its last coming backwards', () => {
    expect(page(body, true)).toBe('go')
  })
  test('in the order its tab indexes ask', () => {
    expect(page('<input id="plain"><button id="early" tabindex="2">Early</button>', false)).toBe('early')
  })
  test('and on the page itself where it has no stop', () => {
    expect(page('<p>Nothing to press</p>', false)).toBe('the page')
  })
})
