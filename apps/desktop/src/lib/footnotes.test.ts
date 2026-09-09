import { describe, expect, test } from 'vitest'
import { scanFootnotes } from './footnotes'

describe('the footnotes of a note', () => {
  test('what each one says, and the line its mark is on', () => {
    const note = ['A claim[^1] and another[^2].', '', '[^1]: first', '[^2]: second'].join('\n')

    expect(scanFootnotes(note)).toEqual([
      { id: '1', text: 'first', line: 0, used: true },
      { id: '2', text: 'second', line: 0, used: true },
    ])
  })

  test('in the order the words reach them, not the order they are defined', () => {
    const note = ['Second[^b] then first[^a].', '', '[^a]: A', '[^b]: B'].join('\n')
    expect(scanFootnotes(note).map((one) => one.id)).toEqual(['b', 'a'])
  })

  test('a label is whatever was written between the brackets', () => {
    expect(scanFootnotes('why[^because]\n\n[^because]: it is').map((one) => one.id)).toEqual([
      'because',
    ])
  })

  test('one nothing points at is still a footnote, and says so', () => {
    const note = 'Words.\n\n[^stray]: left behind'
    expect(scanFootnotes(note)).toEqual([
      { id: 'stray', text: 'left behind', line: 2, used: false },
    ])
  })

  test('and one referred to but never written is one too', () => {
    expect(scanFootnotes('A claim[^1].')).toEqual([{ id: '1', text: '', line: 0, used: true }])
  })

  test('the line is the first mark, however many there are', () => {
    const note = ['one[^1]', 'two', 'three[^1]', '', '[^1]: said once'].join('\n')
    const found = scanFootnotes(note)

    expect(found).toHaveLength(1)
    expect(found[0]?.line).toBe(0)
  })

  test('a definition is not a mention of itself', () => {
    // Without this the row would jump to the bottom of the note rather than to
    // the sentence the mark is in.
    expect(scanFootnotes('Words.\n\n[^1]: said')[0]?.used).toBe(false)
  })

  test('a label written twice is read once, the way the renderer reads it', () => {
    const note = 'A[^1]\n\n[^1]: first\n[^1]: second'
    expect(scanFootnotes(note)).toEqual([{ id: '1', text: 'first', line: 0, used: true }])
  })

  test('nothing inside a fence, where brackets are code', () => {
    const note = ['```', 'const a = b[^1]', '```', '', 'real[^1]', '', '[^1]: said'].join('\n')
    expect(scanFootnotes(note)[0]?.line).toBe(4)
  })

  test('and a note with none costs nothing', () => {
    expect(scanFootnotes('Just words.\n')).toEqual([])
    expect(scanFootnotes('')).toEqual([])
  })
})
