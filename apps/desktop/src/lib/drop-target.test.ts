import { afterEach, describe, expect, test } from 'vitest'
import { dropTarget, targetFor } from './drop-target.svelte'

afterEach(() => {
  dropTarget.clear()
})

describe('what a row stands for when something is dropped on it', () => {
  test('a folder stands for itself', () => {
    expect(targetFor('/s/Work', true)).toBe('/s/Work')
  })

  test('a note stands for the folder it is about to become', () => {
    expect(targetFor('/s/Work/plan.md', false)).toBe('/s/Work/plan')
  })

  test('and so does one at the top of a space', () => {
    expect(targetFor('/s/Read me.md', false)).toBe('/s/Read me')
  })

  test('a PDF or a canvas stands for the folder it sits in', () => {
    expect(targetFor('/s/Work/paper.pdf', false)).toBe('/s/Work')
    expect(targetFor('/s/Work/Board.canvas', false)).toBe('/s/Work')
  })

  test('reads a path written with backslashes', () => {
    expect(targetFor('C:\\s\\Work\\plan.md', false)).toBe('C:\\s\\Work\\plan')
    expect(targetFor('C:\\s\\Work\\paper.pdf', false)).toBe('C:\\s\\Work')
  })
})

describe('the folder a drop would land in', () => {
  test('is nothing while nothing is being dragged', () => {
    expect(dropTarget.folder).toBeNull()
    expect(dropTarget.lit('/s/Work')).toBe(false)
  })

  test('lights the one folder and no other', () => {
    dropTarget.over('/s/Work')

    expect(dropTarget.lit('/s/Work')).toBe(true)
    expect(dropTarget.lit('/s/Work/Notes')).toBe(false)
    expect(dropTarget.lit('/s')).toBe(false)
  })

  test('is the PDF row own folder, so the folder lights and the row does not', () => {
    dropTarget.over(targetFor('/s/Work/paper.pdf', false))

    expect(dropTarget.lit('/s/Work')).toBe(true)
    expect(dropTarget.lit('/s/Work/paper.pdf')).toBe(false)
  })

  test('is the folder a note is about to become, which is that note own row', () => {
    dropTarget.over(targetFor('/s/Work/plan.md', false))

    expect(dropTarget.lit('/s/Work/plan')).toBe(true)
    expect(dropTarget.lit('/s/Work')).toBe(false)
    expect(dropTarget.lit('/s/Work/plan.md')).toBe(false)
  })

  test('moves on to the next folder rather than lighting both', () => {
    dropTarget.over('/s/Work')
    dropTarget.over('/s/Notes')

    expect(dropTarget.lit('/s/Work')).toBe(false)
    expect(dropTarget.lit('/s/Notes')).toBe(true)
  })

  test('goes out when the drag leaves', () => {
    dropTarget.over('/s/Work')
    dropTarget.clear()

    expect(dropTarget.folder).toBeNull()
    expect(dropTarget.lit('/s/Work')).toBe(false)
  })

  test('lights nothing for an empty answer', () => {
    dropTarget.over('')
    expect(dropTarget.lit('')).toBe(false)
  })
})
