import { describe, expect, test } from 'vitest'
import { documentOf, picturesIn } from './document'

const pictures = (source: string) => picturesIn(documentOf(source, 'Note'))
describe('a picture embed that shares its line with something else, in Word, RTF and TextBundle exports', () => {
  test('inside a sentence is a picture, as the reading view draws it', () => {
    expect(pictures('See ![[photo.png]] here.\n')).toEqual(['photo.png'])
  })
  test('beside another picture keeps both pictures', () => {
    expect(pictures('![[before.png]] ![[after.png]]\n')).toEqual(['before.png', 'after.png'])
  })
  test('in a table cell is a picture', () => {
    expect(pictures('| Plant | Leaf |\n| --- | --- |\n| Fern | ![[fern.png]] |\n')).toEqual(['fern.png'])
  })
  test('on a task is a picture', () => {
    expect(pictures('- [ ] Water ![[fern.png]]\n')).toEqual(['fern.png'])
  })
})
