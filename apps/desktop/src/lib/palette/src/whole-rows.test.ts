import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { cutAt } from './whole-rows'

const HEADS = [true, false, false, true, false, false, false]
const BOTTOMS = [27, 55, 83, 106, 134, 162, 190]

describe('a list cut between two rows', () => {
  test('is not cut at all where every row fits, padding and all', () => {
    expect(cutAt(BOTTOMS, HEADS, 194, 4)).toBeNull()
    expect(cutAt(BOTTOMS, HEADS, 400, 4)).toBeNull()
  })

  test('a few pixels short of the list ends at the row before, not on a sliver', () => {
    expect(cutAt(BOTTOMS, HEADS, 188, 4)).toBe(166)
  })

  test('so what is left to scroll to is always a whole row', () => {
    for (let room = 40; room < 194; room++) {
      const cut = cutAt(BOTTOMS, HEADS, room, 4)
      if (cut === null) continue
      expect(cut).toBeLessThanOrEqual(room)
      expect(BOTTOMS.includes(cut - 4)).toBe(true)
    }
  })

  test('never leaves a heading as the last thing above the cut', () => {
    expect(cutAt(BOTTOMS, HEADS, 110, 4)).toBe(87)
  })

  test('has no cut to make in an empty list or in a room smaller than one row', () => {
    expect(cutAt([], [], 100, 4)).toBeNull()
    expect(cutAt(BOTTOMS, HEADS, 20, 4)).toBeNull()
  })

  test('is measured in the palette against a field that keeps its height, so the room it finds is the room it gets', () => {
    const palette = readFileSync(join(import.meta.dirname, './Palette.svelte'), 'utf8')
    expect(palette).toMatch(/\n {2}\.field \{\n(?: {4}[^\n]*\n)*? {4}flex: none;\n/)
  })
})
