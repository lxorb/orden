import { afterEach, describe, expect, test } from 'vitest'
import { dropTarget, targetFor } from './drop-target.svelte'

afterEach(() => {
  dropTarget.clear()
})

describe('what a row stands for when something is dropped on it', () => {
  test('a folder stands for itself', () => {
    expect(targetFor('/s/Work', true)).toBe('/s/Work')
  })

  /** Dropping onto a note nests what was dropped under it, the way a page nests
   *  under a page: the note becomes the folder and what came takes its place
   *  beside it. See folder-notes.ts. */
  test('a note stands for the folder it is about to become', () => {
    expect(targetFor('/s/Work/plan.md', false)).toBe('/s/Work/plan')
  })

  test('and so does one at the top of a space', () => {
    expect(targetFor('/s/Read me.md', false)).toBe('/s/Read me')
  })

  /** Neither can hold a note, so neither becomes a folder, and dropping on one
   *  still means "in here, beside it" - which is what makes a folder holding a
   *  single PDF something a drag can get back out of. */
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

  /** The same answer wherever it is asked: the list is a component per folder,
   *  and the row that lights for a PDF is one another component drew. */
  test('is the PDF row own folder, so the folder lights and the row does not', () => {
    dropTarget.over(targetFor('/s/Work/paper.pdf', false))

    expect(dropTarget.lit('/s/Work')).toBe(true)
    expect(dropTarget.lit('/s/Work/paper.pdf')).toBe(false)
  })

  /** A note's row lights for itself, because the folder it stands for is the one
   *  the drop is about to make out of it: the note's own path without the
   *  extension, which is what the row compares against; see `nesting` in
   *  Tree.svelte. Neither the folder it sits in nor the note's own file name is
   *  the answer. */
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

  /** An empty path is not a folder, so a row whose own answer came out empty
   *  must not light because the two emptinesses matched. */
  test('lights nothing for an empty answer', () => {
    dropTarget.over('')
    expect(dropTarget.lit('')).toBe(false)
  })
})
