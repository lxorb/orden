import { afterEach, describe, expect, test } from 'vitest'
import { dropTarget, targetFor } from './drop-target.svelte'

afterEach(() => {
  dropTarget.clear()
})

describe('what a row stands for when something is dropped on it', () => {
  test('a folder stands for itself', () => {
    expect(targetFor('/s/Work', true)).toBe('/s/Work')
  })

  /** Dropping onto a note means "in here, beside it". Without that a folder
   *  holding a single note would be a folder nothing could be dragged out of. */
  test('a note stands for the folder it sits in', () => {
    expect(targetFor('/s/Work/plan.md', false)).toBe('/s/Work')
  })

  test('a note at the top of a space stands for the space', () => {
    expect(targetFor('/s/Read me.md', false)).toBe('/s')
  })

  test('reads a path written with backslashes', () => {
    expect(targetFor('C:\\s\\Work\\plan.md', false)).toBe('C:\\s\\Work')
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

  /** The same answer wherever it is asked: the list is a component per folder,
   *  and the row that lights for a note is one another component drew. */
  test('is the note row own folder, so the note itself never lights', () => {
    dropTarget.over(targetFor('/s/Work/plan.md', false))

    expect(dropTarget.lit('/s/Work')).toBe(true)
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

  /** An empty path is not a folder, so a row whose own answer came out empty
   *  must not light because the two emptinesses matched. */
  test('lights nothing for an empty answer', () => {
    dropTarget.over('')
    expect(dropTarget.lit('')).toBe(false)
  })
})
