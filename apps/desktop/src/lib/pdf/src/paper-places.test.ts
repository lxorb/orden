import { describe, expect, test } from 'vitest'
import { paperPlaces } from './paper'

describe('where a page looks for its paper', () => {
  test("in the note's own paper first, then where its name points", () => {
    expect(paperPlaces('Lecture.pdf', '/s/Week/Lecture.pages', '/s')).toEqual([
      '/s/Week/Lecture.pages.pdf',
      '/s/Week/Lecture.pdf',
      '/s/Lecture.pdf',
    ])
  })

  test('once, where the page names that paper already', () => {
    expect(paperPlaces('Optics.pages.pdf', '/s/Optics.pages', '/s')).toEqual([
      '/s/Optics.pages.pdf',
    ])
  })

  test('and only where it names one: a blank sheet has no paper behind it', () => {
    expect(paperPlaces('', '/s/Lecture.pages', '/s')).toEqual([])
  })

  test('a canvas has no paper of its own', () => {
    expect(paperPlaces('paper.pdf', '/s/Board.canvas', '/s')).toEqual(['/s/paper.pdf'])
  })
})
