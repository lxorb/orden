import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'

const PlaceIcon = (await import('./PlaceIcon.svelte')).default
let target: HTMLElement
let close: (() => void) | undefined
afterEach(() => {
  close?.()
  target.remove()
})
function shown(props: Record<string, unknown>): Element {
  target = document.createElement('div')
  document.body.append(target)
  const made = mount(PlaceIcon, { target, props: props as never })
  close = () => void unmount(made)
  flushSync()
  const icon = target.querySelector('[data-time-place-icon]')
  if (!icon) throw new Error('no icon')
  return icon
}
const visible = (icon: Element) => icon.textContent.trim() !== '' || icon.querySelector('svg, img') !== null
test('a website is never shown without an icon: its brand once the brands are in, else its first letter', () => {
  const brand = shown({ lane: 'site', place: 'github.com', name: 'github.com' })
  expect(visible(brand)).toBe(true)
  close?.()
  target.remove()
  const unknown = shown({ lane: 'site', place: 'quiet-place.example', name: 'quiet-place.example' })
  expect(unknown.querySelector('.tile')?.textContent.trim()).toBe('Q')
})
test('an app nobody made a brand for shows its first letter', () => {
  const app = shown({ lane: 'app', place: 'xterm', name: 'xterm' })
  expect(app.textContent.trim()).toBe('X')
})
