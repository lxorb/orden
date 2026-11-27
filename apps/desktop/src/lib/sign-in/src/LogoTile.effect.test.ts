import { type Component, flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import LogoTile from './LogoTile.svelte'
import Mark from './Mark.svelte'

const ICON_GLYPH = 264 / 512
let close: (() => void) | undefined
afterEach(() => {
  close?.()
  close = undefined
  document.body.innerHTML = ''
})
function shown<Props extends Record<string, unknown>>(component: Component<Props>, props: Props): HTMLElement {
  const target = document.createElement('div')
  document.body.append(target)
  const made = mount(component, { target, props, intro: false })
  close = () => void unmount(made)
  flushSync()
  return target
}
describe('the Orden mark in the setup', () => {
  test('covers as much of its tile as the glyph covers the app icon', () => {
    const svg = shown(Mark, { size: 256 }).querySelector('svg')
    const side = Number(svg?.getAttribute('viewBox')?.split(' ')[2])
    const rects = [...(svg?.querySelectorAll('rect') ?? [])].map((one) => ({
      x: Number(one.getAttribute('x')),
      y: Number(one.getAttribute('y')),
      right: Number(one.getAttribute('x')) + Number(one.getAttribute('width')),
      bottom: Number(one.getAttribute('y')) + Number(one.getAttribute('height')),
    }))
    const wide = (Math.max(...rects.map((one) => one.right)) - Math.min(...rects.map((one) => one.x))) / side
    const tall = (Math.max(...rects.map((one) => one.bottom)) - Math.min(...rects.map((one) => one.y))) / side
    expect(Math.abs(wide - ICON_GLYPH)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(tall - ICON_GLYPH)).toBeLessThanOrEqual(0.01)
  })
  test('fills its tile edge to edge at every size', () => {
    for (const size of [76, 88, 112]) {
      const tile = shown(LogoTile, { size }).firstElementChild as HTMLElement
      const svg = tile.querySelector('svg')
      expect(tile.style.width).toBe(`${size}px`)
      expect(tile.style.height).toBe(`${size}px`)
      expect(svg?.getAttribute('width')).toBe(String(size))
      expect(svg?.getAttribute('height')).toBe(String(size))
      close?.()
      close = undefined
    }
  })
})
