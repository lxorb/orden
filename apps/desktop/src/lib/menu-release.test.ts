import { describe, expect, test } from 'vitest'
import { released, shortcutPassesBy, SLOP } from './menu-release'

describe('a held menu let go of', () => {
  const from = { x: 100, y: 100 }

  test('where it was pressed, stays open to be clicked, as a click leaves it', () => {
    expect(released(from, from, 'outside')).toBe('stay')
    expect(released(from, { x: 100 + SLOP, y: 100 }, 'row')).toBe('stay')
  })

  test('on a row it was slid onto, chooses it', () => {
    expect(released(from, { x: 130, y: 160 }, 'row')).toBe('choose')
  })

  test('on the menu between its rows, stays; anywhere else, closes', () => {
    expect(released(from, { x: 130, y: 160 }, 'menu')).toBe('stay')
    expect(released(from, { x: 400, y: 60 }, 'outside')).toBe('close')
  })
})

describe('a shortcut pressed while a menu is up', () => {
  const press = (key: string, held: { ctrlKey?: boolean; metaKey?: boolean } = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    ...held,
  })

  test('closes it, on its way to whatever it does', () => {
    expect(shortcutPassesBy(press(',', { ctrlKey: true }))).toBe(true)
    expect(shortcutPassesBy(press('p', { metaKey: true }))).toBe(true)
  })

  test('but not a modifier pressed on its own, nor the keys that walk or spell the menu', () => {
    expect(shortcutPassesBy(press('Control', { ctrlKey: true }))).toBe(false)
    expect(shortcutPassesBy(press('Meta', { metaKey: true }))).toBe(false)
    expect(shortcutPassesBy(press('ArrowDown'))).toBe(false)
    expect(shortcutPassesBy(press('r'))).toBe(false)
  })
})
