import { afterEach, describe, expect, test } from 'vitest'
import { Spot, spacedIn } from './spot'

let box: HTMLElement

function field(value: string, from: number, to = from): HTMLTextAreaElement {
  box = document.createElement('div')
  const one = document.createElement('textarea')
  one.value = value
  box.append(one)
  document.body.append(box)
  Object.defineProperty(one, 'offsetParent', { get: () => box })
  one.focus()
  one.setSelectionRange(from, to)
  return one
}

function typed(one: HTMLTextAreaElement, value: string, caret: number) {
  one.value = value
  one.setSelectionRange(caret, caret)
  one.dispatchEvent(new Event('input', { bubbles: true }))
}

afterEach(() => box.remove())

describe('dictated words', () => {
  test('land at the caret, with a space either side where they touch', () => {
    const one = field('Hallo Welt', 5)
    const spot = new Spot(one, () => undefined)
    spot.show('liebe', false)
    expect(one.value).toBe('Hallo liebe Welt')
    expect(one.selectionStart).toBe('Hallo liebe '.length - 1)
  })

  test('replace the selection, and Escape puts it back', () => {
    const one = field('Bitte morgen anrufen', 6, 12)
    const spot = new Spot(one, () => undefined)
    spot.show('übermorgen', true)
    expect(one.value).toBe('Bitte übermorgen anrufen')
    spot.restore()
    expect(one.value).toBe('Bitte morgen anrufen')
  })

  test('are written over as the live words change, and once more at the end', () => {
    const one = field('', 0)
    const spot = new Spot(one, () => undefined)
    spot.show('Kannst du', true)
    spot.show('Kannst du bitte den Pull', true)
    spot.show('Kannst du bitte den Pull Request reviewen?', false)
    expect(one.value).toBe('Kannst du bitte den Pull Request reviewen?')
    expect(one.selectionStart).toBe(one.value.length)
  })

  test('raise an input, so a field bound to state takes them as typing', () => {
    const one = field('', 0)
    const seen: string[] = []
    one.addEventListener('input', () => seen.push(one.value))
    new Spot(one, () => undefined).show('Hallo', false)
    expect(seen).toEqual(['Hallo'])
  })

  test('are drawn as live while they are, and plain once final', () => {
    const one = field('', 0)
    const spot = new Spot(one, () => undefined)
    spot.show('Hallo', true)
    const wash = box.querySelector('[data-heard] mark')
    expect(wash?.textContent).toBe('Hallo')
    spot.show('Hallo.', false)
    expect(box.querySelector('[data-heard]')).toBeNull()
  })

  test('move along with typing before them', () => {
    const one = field('Welt', 0)
    const spot = new Spot(one, () => undefined)
    spot.show('schöne', true)
    expect(one.value).toBe('schöne Welt')
    typed(one, 'Hallo schöne Welt', 6)
    spot.show('wunderschöne', false)
    expect(one.value).toBe('Hallo wunderschöne Welt')
  })

  test('stay put with typing after them', () => {
    const one = field('', 0)
    const spot = new Spot(one, () => undefined)
    spot.show('Erster Teil', true)
    typed(one, 'Erster Teil und mehr', 20)
    spot.show('Erster Teil, korrigiert', false)
    expect(one.value).toBe('Erster Teil, korrigiert und mehr')
  })

  test('are the reader’s once typed into: dictation ends with them as they are', () => {
    const one = field('', 0)
    let ended = 0
    const spot = new Spot(one, () => ended++)
    spot.show('Hallo Welt', true)
    typed(one, 'Hallo schöne Welt', 12)
    expect(ended).toBe(1)
    expect(box.querySelector('[data-heard]')).toBeNull()
  })
})

describe('the space beside dictated words', () => {
  test('is added only where the words would touch', () => {
    expect(spacedIn('Hallo', 'Welt', '')).toBe(' Welt')
    expect(spacedIn('Hallo ', 'Welt', '')).toBe('Welt')
    expect(spacedIn('', 'Hallo', 'Welt')).toBe('Hallo ')
    expect(spacedIn('', 'Hallo', '.')).toBe('Hallo')
    expect(spacedIn('', 'Hallo', '\nWelt')).toBe('Hallo')
    expect(spacedIn('Hallo', '', 'Welt')).toBe('')
  })
})
