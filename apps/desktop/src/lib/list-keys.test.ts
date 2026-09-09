import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { opensAt, spelled, type Walk, walk } from './list-keys'

/** Walking a dropdown with the keyboard.
 *
 *  The rule the whole file exists for is the last block: a keystroke chooses the
 *  row the keyboard walked to and never one the pointer passed over. The pointer
 *  does not appear here at all, which is the point - it cannot move this. */

const KEYBOARDS = ['Default', 'Notion', 'Obsidian', 'Vim']

/** A keystroke, at a moment. The timestamps only matter to typing letters in a
 *  row, so everything else is handed the same one. */
const at = (from: Walk, key: string, moment = 1000) => walk(key, moment, KEYBOARDS, from)

describe('opening the list', () => {
  test('puts the keyboard on the row the value is', () => {
    expect(opensAt(2)).toEqual({ cursor: 2, typed: '', typedAt: 0 })
  })

  /** A value the list does not hold - a preset a newer build named - leaves the
   *  keyboard on no row, so Enter cannot commit the first one instead. */
  test('puts it on no row at all where the list does not hold the value', () => {
    expect(opensAt(-1).cursor).toBeNull()
  })
})

describe('walking it', () => {
  test('steps down and wraps at the end', () => {
    expect(at(opensAt(2), 'ArrowDown').walk.cursor).toBe(3)
    expect(at(opensAt(3), 'ArrowDown').walk.cursor).toBe(0)
  })

  test('steps up and wraps at the start', () => {
    expect(at(opensAt(1), 'ArrowUp').walk.cursor).toBe(0)
    expect(at(opensAt(0), 'ArrowUp').walk.cursor).toBe(3)
  })

  test('goes to either end', () => {
    expect(at(opensAt(2), 'Home').walk.cursor).toBe(0)
    expect(at(opensAt(0), 'End').walk.cursor).toBe(3)
  })

  test('starts at one end when it was on no row', () => {
    expect(at(opensAt(-1), 'ArrowDown').walk.cursor).toBe(0)
    expect(at(opensAt(-1), 'ArrowUp').walk.cursor).toBe(3)
  })

  test('jumps to what is being spelled, letters in a row counting as one word', () => {
    const first = at(opensAt(0), 'o')
    expect(first.walk.cursor).toBe(2)

    // `ob` within the moment, so still Obsidian rather than back to nothing.
    const second = walk('b', 1300, KEYBOARDS, first.walk)
    expect(second.walk.cursor).toBe(2)
    expect(second.walk.typed).toBe('ob')
  })

  test('and starts the word again after a pause', () => {
    const first = at(opensAt(0), 'o')
    const later = walk('v', 4000, KEYBOARDS, first.walk)

    expect(later.walk.typed).toBe('v')
    expect(later.walk.cursor).toBe(3)
  })

  test('stays where it is for a word no row starts with', () => {
    expect(at(opensAt(1), 'z').walk.cursor).toBe(1)
  })

  test('leaves a key that is nobody else’s alone', () => {
    const step = at(opensAt(1), 'F5')
    expect(step.took).toBe(false)
    expect(step.walk.cursor).toBe(1)
  })

  test('does nothing at all to an empty list', () => {
    expect(walk('ArrowDown', 0, [], opensAt(-1))).toEqual({
      walk: { cursor: null, typed: '', typedAt: 0 },
      took: false,
    })
  })
})

describe('leaving it', () => {
  test('Enter chooses the row the keyboard is on', () => {
    expect(at(opensAt(1), 'Enter')).toMatchObject({ chose: 1, shut: true, took: true })
  })

  test('so does a space, which the page underneath never sees', () => {
    const step = at(opensAt(3), ' ')
    expect(step).toMatchObject({ chose: 3, shut: true })
    expect(step.took).toBe(true)
  })

  test('Tab closes it and lets the focus go on its way', () => {
    const step = at(opensAt(1), 'Tab')
    expect(step.shut).toBe(true)
    expect(step.chose).toBeUndefined()
    expect(step.took).toBe(false)
  })
})

/** The bug this file was pulled out of the component for.
 *
 *  One cursor was shared between the pointer and the keys, and a hover moved it.
 *  So reading the keyboard list with the mouse and then pressing Space chose
 *  whatever the pointer had last crossed - the bottom row, which is Vim - and
 *  choosing Vim turns modal editing on for every device on the account. */
describe('a keystroke chooses nothing the keyboard did not walk to', () => {
  test('a list opened and left alone chooses the value it already had', () => {
    // Which is the same as choosing nothing: the component only tells anybody
    // when the value actually changes.
    expect(at(opensAt(0), 'Enter').chose).toBe(0)
  })

  test('and one whose value it does not hold chooses nothing at all', () => {
    const step = at(opensAt(-1), 'Enter')

    expect(step.chose).toBeUndefined()
    expect(step.shut).toBe(true)
  })

  test('a space after walking chooses exactly where the walking ended', () => {
    const walked = at(at(opensAt(0), 'ArrowDown').walk, 'ArrowDown')
    expect(at(walked.walk, ' ').chose).toBe(2)
  })

  /** Read off the source, because the accident was one line of markup: the
   *  pointer gets a highlight of its own and never the keyboard's cursor. */
  test('and the pointer has a highlight of its own to move', () => {
    const source = readFileSync(fileURLToPath(new URL('./Select.svelte', import.meta.url)), {
      encoding: 'utf8',
    })

    expect(source).toContain('onmouseenter={() => (hovered = index)}')
    expect(source).not.toMatch(/onmouseenter=\{\(\) => \(walking/)
    // And what the keyboard is on is what a screen reader is told is active.
    expect(source).toContain('aria-activedescendant={open && walking.cursor !== null')
  })
})

/** The same spelling every list in the app uses. A dropdown reads it through
 *  `walk` above; the file tree, the outline, the strip of tabs and the rest read it
 *  straight, because there the row lives in the page rather than in state. See
 *  roving.ts. */
describe('spelling a name', () => {
  const NAMES = ['Groceries', 'Journal', 'Notes on Kant', 'notes.md', 'Work']

  /** Letters typed one after another, `gap` apart. */
  function say(letters: string, gap = 100) {
    let state = { typed: '', typedAt: 0 }
    let found = -1
    let at = 1000

    for (const letter of letters) {
      const next = spelled(state, letter, at, NAMES)
      state = { typed: next.typed, typedAt: next.typedAt }
      found = next.found
      at += gap
    }

    return { found, typed: state.typed }
  }

  test('lands on the first row that starts with the letter', () => {
    expect(say('j').found).toBe(1)
    expect(say('w').found).toBe(4)
  })

  test('narrows as more letters arrive', () => {
    expect(say('n').found).toBe(2)
    expect(say('note').found).toBe(2)
    expect(say('notes.').found).toBe(3)
  })

  test('and pays no attention to case, in the word or in the row', () => {
    expect(say('N').found).toBe(2)
    expect(say('GRO').found).toBe(0)
  })

  /** A pause is how a hand says it has stopped spelling one name and started
   *  another: "j", then a second later "w", is two names asked for and not a word
   *  spelled "jw". */
  test('starts a fresh word after a pause', () => {
    expect(say('jw', 900).found).toBe(4)
    expect(say('jw', 900).typed).toBe('w')
  })

  test('and leaves the keyboard where it was on a word no row starts with', () => {
    expect(say('zz').found).toBe(-1)
  })
})
