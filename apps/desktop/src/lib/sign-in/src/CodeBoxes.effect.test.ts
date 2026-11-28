import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import CodeBoxes from './CodeBoxes.svelte'

let close: (() => void) | undefined
afterEach(() => {
  close?.()
  close = undefined
  document.body.innerHTML = ''
})
function opened(): { target: HTMLElement; field: HTMLInputElement; code: () => string } {
  const target = document.createElement('div')
  document.body.append(target)
  const made = mount(CodeBoxes, { target, props: {} })
  close = () => void unmount(made)
  flushSync()
  const field = target.querySelector('input')!
  return { target, field, code: () => field.value }
}
function types(field: HTMLInputElement, text: string) {
  field.value += text
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}
const shown = (target: HTMLElement) => [...target.querySelectorAll('.box')].map((box) => box.textContent)
describe('the boxes a sign-in code is typed into (#2286)', () => {
  test('are one field, so a code typed, pasted or filled in fast never changes hands between boxes', () => {
    const { target, field } = opened()
    expect(target.querySelectorAll('input')).toHaveLength(1)
    expect(field.autocomplete).toBe('one-time-code')
    expect(field.inputMode).toBe('numeric')
    expect(field.getAttribute('aria-label')).toBe('Sign-in code')
    expect(target.querySelectorAll('.box[aria-hidden="true"]')).toHaveLength(6)
  })
  test('keep the digits in the order they came, however they were cut up on the way', () => {
    for (const pieces of [
      ['123456'],
      ['1', '2', '3', '4', '5', '6'],
      ['12', '3456'],
      ['12345', '6'],
      ['1', '23', '456'],
    ]) {
      const { target, field, code } = opened()
      for (const piece of pieces) types(field, piece)
      expect(code(), pieces.join(' ')).toBe('123456')
      expect(shown(target), pieces.join(' ')).toEqual(['1', '2', '3', '4', '5', '6'])
      close?.()
      close = undefined
    }
  })
  test('take digits only, and no more than six', () => {
    const { target, field, code } = opened()
    types(field, '12 3-4a')
    expect(code()).toBe('1234')
    expect(field.value).toBe('1234')
    types(field, '56789')
    expect(code()).toBe('123456')
    expect(shown(target)).toEqual(['1', '2', '3', '4', '5', '6'])
  })
  test('give a finger the whole row to land on, 48 high at the least', () => {
    const source = readFileSync(join(import.meta.dirname, 'CodeBoxes.svelte'), 'utf8')
    expect(source).toMatch(/input \{\s*position: absolute;\s*inset: 0;\s*width: 100%;\s*height: 100%;/)
    const heights = [...source.matchAll(/\.box \{[^}]*?height: (\d+)px/g)].map(([, height]) => Number(height))
    expect(heights.length).toBe(2)
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(48)
  })
})
describe('a screen of the setup or of a phone app’s first screen (#2286)', () => {
  const source = readFileSync(join(import.meta.dirname, 'Screen.svelte'), 'utf8')
  test('ends on the keyboard and not under it, and brings the field being typed in into sight', () => {
    expect(source).toMatch(/\.screen \{[^}]*inset-block: 0 var\(--keyboard, 0px\);/)
    expect(source).toContain('showField(on, body, body.getBoundingClientRect().bottom)')
    expect(source).toContain('if (viewport.keyboard >= 0) shown()')
  })
  test('gives Back a height a finger can hit', () => {
    expect(source).toMatch(/\.back \{[^}]*min-height: 48px;/)
  })
})
