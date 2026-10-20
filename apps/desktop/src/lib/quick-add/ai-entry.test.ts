import { describe, expect, test } from 'vitest'
import { entryFrom, entryMessages } from './ai-entry'
import { linesOf } from './entry'

/** Add with AI (#328): the reply kept only as far as it checks out. */

const SAID =
  'oh man I gotta do the laundry. I can do it from tomorrow and should be done by eow at the latest.'
const TAGS = ['home', 'chores']
const NOTES = ['Household', 'Work']

describe('Add with AI', () => {
  test('tells the model the day, the labels and the notes', () => {
    const [, asked] = entryMessages(SAID, TAGS, NOTES, '2026-10-20', 'Europe/Berlin')
    expect(asked?.content).toBe(
      `Today is Tuesday, 2026-10-20, in Europe/Berlin.\nLabels: ["home","chores"]\nNotes: ["Household","Work"]\n\n${SAID}`,
    )
  })

  test('writes the laundry with its start, deadline, priority and known labels', () => {
    const reply =
      '```json\n{"text": "Do the laundry", "tags": ["#chores", "laundry"], "start": "2026-10-21", "deadline": "2026-10-23", "priority": 3, "note": "Household"}\n```'
    const entry = entryFrom(reply, SAID, TAGS, NOTES)
    expect(entry.note).toBe('Household')
    expect(linesOf(entry)).toEqual([
      '- [ ] Do the laundry [deadline:: 2026-10-23] #chores 🔼 🛫 2026-10-21',
    ])
  })

  test('keeps the sentence where the reply says nothing that checks out', () => {
    const reply =
      '{"tags": "chores", "start": "2026-02-30", "deadline": "Friday", "priority": 9, "note": "Elsewhere"}'
    expect(entryFrom(reply, SAID, TAGS, NOTES)).toEqual({
      text: SAID,
      fields: { tags: [], remind: [] },
    })
  })

  test('throws on a reply that is not JSON', () => {
    expect(() => entryFrom('Sure! Here is your task.', SAID, TAGS, NOTES)).toThrow()
  })
})
