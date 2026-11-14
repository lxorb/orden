import { flushSync, mount } from 'svelte'
import { expect, test } from 'vitest'
import SettingsPanel from '../../src/lib/settings/src/SettingsPanel.svelte'
import { settings } from '../../src/lib/settings.svelte'

Element.prototype.animate = () => ({ finished: Promise.resolve() }) as unknown as Animation
globalThis.ResizeObserver = class {
  observe = () => undefined
  unobserve = () => undefined
  disconnect = () => undefined
}

test('the `i` turns nothing, and no switch holds anything the keyboard can reach', () => {
  settings.section = 'markdown'
  mount(SettingsPanel, { target: document.body })
  flushSync()

  const hint = document.querySelector('button[aria-label^="Turns straight quotes"]')
  const toggle = [...document.querySelectorAll('[role="switch"]')].find((one) =>
    one.closest('.setting')?.contains(hint),
  )
  const before = toggle?.getAttribute('aria-checked')
  for (const key of ['Enter', ' ']) {
    hint?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    flushSync()
    expect(toggle?.getAttribute('aria-checked')).toBe(before)
  }

  for (const one of document.querySelectorAll('[role="switch"]'))
    expect(one.querySelector('button, [tabindex]')).toBeNull()
})
