import type { Entry } from '@orden/contracts'
import { describe, expect, test } from 'vitest'
import { shownNames } from '../../tree/src/api'
import { movedTo, placedBeside, stepped, trimmed } from './tree-arranging'

function file(name: string): Entry {
  return { name, path: `/s/${name}`, is_dir: false, modified: 0, created: 0, children: [] }
}
function folder(name: string): Entry {
  return { ...file(name), is_dir: true }
}
describe('what a folder keeps of the order it is drawn in', () => {
  const three = [file('a.md'), file('b.md'), file('c.md')]
  const mixed = [folder('A'), folder('B'), file('a.md'), file('b.md')]
  test.each([
    ['nothing while the order is the one it would have read in anyway', 'abc', ['a.md', 'b.md', 'c.md'], []],
    ['only as far as somebody actually arranged', 'abc', ['c.md', 'a.md', 'b.md'], ['c.md']],
    ['the whole of a reversed order', 'abc', ['c.md', 'b.md', 'a.md'], ['c.md', 'b.md']],
    ['nothing where the folders lead, as they already were', 'mixed', ['A', 'B', 'a.md', 'b.md'], []],
    ['the note somebody put above the folders', 'mixed', ['a.md', 'A', 'B', 'b.md'], ['a.md']],
  ])('%s', (_, which, order, kept) => {
    expect(trimmed(which === 'abc' ? three : mixed, order)).toEqual(kept)
  })
  test('what it keeps draws the order it was given', () => {
    const four = [file('a.md'), file('b.md'), file('c.md'), file('d.md')]
    const want = ['c.md', 'a.md', 'b.md', 'd.md']
    expect(shownNames(four, 'manual', trimmed(four, want))).toEqual(want)
  })
  test('and the same where a note sits between two folders', () => {
    const want = ['A', 'a.md', 'B', 'b.md']
    expect(shownNames(mixed, 'manual', trimmed(mixed, want))).toEqual(want)
  })
})
describe('a row put somewhere by hand', () => {
  const four = ['a.md', 'b.md', 'c.md', 'd.md']
  test.each([
    ['lands above the row it was dropped on', ['d.md'], 1, ['a.md', 'd.md', 'b.md', 'c.md']],
    ['lands below it', ['a.md'], 3, ['b.md', 'c.md', 'a.md', 'd.md']],
    ['takes the whole selection, in list order', ['d.md', 'b.md'], 0, ['b.md', 'd.md', 'a.md', 'c.md']],
    ['goes to the end for an index past it', ['a.md'], 99, ['b.md', 'c.md', 'd.md', 'a.md']],
    ['changes nothing landing where it already was', ['b.md'], 1, four],
    ['ignores a name the list does not hold', ['gone.md'], 0, four],
  ])('%s', (_, moving, at, order) => {
    expect(movedTo(four, moving, at)).toEqual(order)
  })
})
describe('dropping a row beside another', () => {
  const children = [folder('Deep'), file('a.md'), file('b.md'), file('c.md')]
  test('above the row it was dropped on', () => {
    expect(placedBeside(children, [], ['c.md'], 'a.md', false)).toEqual(['Deep', 'c.md'])
  })
  test('below it, and the list runs only as far as the move reached', () => {
    expect(placedBeside(children, [], ['a.md'], 'b.md', true)).toEqual(['Deep', 'b.md'])
    expect(shownNames(children, 'manual', ['Deep', 'b.md'])).toEqual(['Deep', 'b.md', 'a.md', 'c.md'])
  })
  test('a folder dropped among the notes stays where it was dropped', () => {
    expect(shownNames(children, 'manual', placedBeside(children, [], ['Deep'], 'b.md', true))).toEqual([
      'a.md',
      'b.md',
      'Deep',
      'c.md',
    ])
  })
  test('and a note dropped above the folder stays above it', () => {
    expect(shownNames(children, 'manual', placedBeside(children, [], ['c.md'], 'Deep', false))).toEqual([
      'c.md',
      'Deep',
      'a.md',
      'b.md',
    ])
  })
})
describe('one step with a key', () => {
  const three = ['a.md', 'b.md', 'c.md']
  test.each([
    ['up', three, 'c.md', -1, ['a.md', 'c.md', 'b.md']],
    ['down', three, 'a.md', 1, ['b.md', 'a.md', 'c.md']],
    ['nothing off the top', three, 'a.md', -1, null],
    ['nothing off the bottom', three, 'c.md', 1, null],
    ['nothing for a name the list does not hold', three, 'gone.md', 1, null],
    ['over a folder as readily as over a note', ['Deep', 'a.md'], 'a.md', -1, ['a.md', 'Deep']],
  ])('%s', (_, names, name, by, order) => {
    expect(stepped(names, name, by)).toEqual(order)
  })
})
