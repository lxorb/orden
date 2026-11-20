import { afterEach, describe, expect, test } from 'vitest'
import { cardPlace, keepFocus } from './keep-focus'

let host: HTMLElement
let stop: (() => void) | undefined
afterEach(() => {
  stop?.()
  host.remove()
})
function board(cards: readonly string[]): HTMLElement {
  host = document.createElement('div')
  host.tabIndex = -1
  const column = document.createElement('div')
  column.dataset.column = 'To do'
  cards.forEach((name, index) => {
    const slot = document.createElement('div')
    slot.dataset.index = String(index)
    const card = document.createElement('div')
    card.dataset.card = ''
    card.tabIndex = -1
    card.textContent = name
    slot.append(card)
    column.append(slot)
  })
  const add = document.createElement('button')
  add.dataset.newPage = ''
  column.append(add)
  host.append(column)
  document.body.append(host)
  const kept = keepFocus(host, (focused) => cardPlace(host, focused))
  stop = () => kept.destroy()
  return column
}
const settle = () => new Promise((done) => setTimeout(done, 0))
function renumber(column: HTMLElement) {
  ;[...column.querySelectorAll<HTMLElement>('[data-index]')].forEach(
    (one, index) => (one.dataset.index = String(index)),
  )
}
const focusedText = () => document.activeElement?.textContent ?? null
describe('a card that leaves the board while it has the keyboard (#2359)', () => {
  test('hands it to the card after it, so the keys go on working there', async () => {
    const column = board(['Plan', 'Draft', 'Ship'])
    column.querySelectorAll<HTMLElement>('[data-card]')[1]?.focus()
    column.querySelectorAll('[data-index]')[1]?.remove()
    renumber(column)
    await settle()
    expect(focusedText()).toBe('Ship')
    let heard = ''
    host.addEventListener('keydown', (event) => (heard = event.key))
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    expect(heard).toBe('z')
  })
  test('to the one before it when it was the last, and to the column’s new card when none is left', async () => {
    const column = board(['Plan', 'Ship'])
    column.querySelectorAll<HTMLElement>('[data-card]')[1]?.focus()
    column.querySelectorAll('[data-index]')[1]?.remove()
    await settle()
    expect(focusedText()).toBe('Plan')
    column.querySelector('[data-index]')?.remove()
    await settle()
    expect(document.activeElement).toBe(column.querySelector('[data-new-page]'))
  })
  test('lets the keyboard go where it was taken on purpose', async () => {
    const column = board(['Plan', 'Ship'])
    const away = document.createElement('input')
    document.body.append(away)
    column.querySelector<HTMLElement>('[data-card]')?.focus()
    away.focus()
    column.querySelector('[data-index]')?.remove()
    await settle()
    expect(document.activeElement).toBe(away)
    away.remove()
  })
})
