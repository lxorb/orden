import { describe, expect, test } from 'vitest'
import { released, SLOP } from './menu-release'

/** A menu opened by a press still held - a Mac's and Linux's way - let go of (#368). */
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
