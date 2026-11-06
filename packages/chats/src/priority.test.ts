import { describe, expect, test } from 'vitest'
import { byPriority, levelIn, priorityAsk, suggestionAsk, suggestionIn } from './priority'

describe('priorities', () => {
  test("a reply's level, however the model words it", () => {
    expect(levelIn('urgent')).toBe('urgent')
    expect(levelIn('Important.')).toBe('important')
    expect(levelIn('I would say If-Time')).toBe('if-time')
    expect(levelIn('if time')).toBe('if-time')
    expect(levelIn('unimportant')).toBe('unimportant')
    expect(levelIn('no idea')).toBeNull()
  })

  test('higher first, then whatever has waited longest, unsorted last', () => {
    const rows = [
      { id: 'a', level: 'important' as const, since: 30 },
      { id: 'b', level: 'urgent' as const, since: 50 },
      { id: 'c', level: null, since: 1 },
      { id: 'd', level: 'important' as const, since: 10 },
      { id: 'e', level: 'important' as const, since: null },
    ]
    expect(rows.sort(byPriority).map((one) => one.id)).toEqual(['b', 'd', 'a', 'e', 'c'])
  })

  test("the ask carries the reader's corrections and only the newest messages", () => {
    const said = Array.from({ length: 20 }, (_, at) => ({
      from: 'Lucile',
      words: `message ${at}`,
      mine: at === 19,
    }))
    const [system, user] = priorityAsk('Lunch', said, [
      { title: 'Reels', from: 'Mia', words: 'look at this', level: 'unimportant' },
    ])
    expect(system?.content).toContain('"Reels" from Mia: "look at this" -> unimportant')
    expect(user?.content).toContain('message 12')
    expect(user?.content).not.toContain('message 11')
    expect(user?.content).toContain('Me: message 19')
  })
})

describe('suggestions', () => {
  test('a reply and a task out of what the model answers, whatever is around them', () => {
    expect(
      suggestionIn(
        'Sure:\n```json\n{"reply":"klar, bis 12!","todo":{"title":"Table for 3","priority":2,"tags":["lunch","bad tag"],"due":"2026-11-07"}}\n```',
      ),
    ).toEqual({
      reply: 'klar, bis 12!',
      todo: { title: 'Table for 3', priority: 2, tags: ['lunch'], due: '2026-11-07' },
    })
    expect(suggestionIn('{"reply":null,"todo":null}')).toBeNull()
    expect(suggestionIn('no json')).toBeNull()
    expect(suggestionIn('{"reply":"ok","todo":{"title":"","due":"soon"}}')).toEqual({
      reply: 'ok',
      todo: null,
    })
  })

  test("the ask carries the reader's own writing as the style", () => {
    const [system] = suggestionAsk(
      'Lunch',
      [{ from: 'Lucile', words: 'noon?', mine: false }],
      ['jo passt'],
      '2026-11-06',
    )
    expect(system?.content).toContain('- jo passt')
    expect(system?.content).toContain('Today is 2026-11-06')
  })
})
