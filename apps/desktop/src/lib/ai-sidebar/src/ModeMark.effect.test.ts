import Bot from 'lucide/dist/esm/icons/bot.mjs'
import { flushSync, mount, unmount } from 'svelte'
import { expect, test } from 'vitest'
import { MODES } from '../../ai-providers/src/api'
import ModeMark from './ModeMark.svelte'
import { MODE_ICONS } from './mode-icons'

const LIGHTNING = 'M7.4 1.6L3.2 7.4h3.2l-.8 4 4.2-5.8H6.6z'
function drawn(mode: (typeof MODES)[number]) {
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(ModeMark, { target, props: { mode } })
  flushSync()
  const svg = target.querySelector('svg')
  const out = { box: svg?.getAttribute('viewBox'), parts: [...(svg?.children ?? [])].map((one) => one.outerHTML) }
  void unmount(shown)
  target.remove()
  return out
}
test('Auto is drawn with an icon of Orden’s set, never a lightning bolt (#2363)', () => {
  const auto = drawn('auto')
  expect(auto.box).toBe('0 0 24 24')
  expect(auto.parts).toHaveLength(Bot.length)
  expect(auto.parts.join('')).not.toContain(LIGHTNING)
})
test('every mode has its own icon from Orden’s set (#2363)', () => {
  const marks = MODES.map((one) => drawn(one).parts.join(''))
  expect(new Set(marks).size).toBe(MODES.length)
  for (const one of MODES) expect(MODE_ICONS[one].length).toBeGreaterThan(0)
})
