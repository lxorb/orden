// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest'
import { type Heard, Priorities } from './priorities.svelte'

const said = (words: string, at: number, mine = false): Heard => ({
  from: mine ? 'Me' : 'Lucile',
  words,
  mine,
  at,
})

beforeEach(() => localStorage.clear())

describe('chat priorities', () => {
  test('off by default, and nothing is asked while off', async () => {
    const priorities = new Priorities()
    let asked = 0
    priorities.useAsker(() => () => {
      asked++
      return Promise.resolve('urgent')
    })
    expect(priorities.on).toBe(false)
    expect(await priorities.heard('k', 'Lunch', [said('fire!', 1)])).toBeNull()
    expect(asked).toBe(0)
  })

  test("a new message by somebody else is given the AI's level, once per message", async () => {
    const priorities = new Priorities()
    const asks: string[] = []
    priorities.useAsker(() => (messages) => {
      asks.push(messages.map((one) => one.content).join('\n'))
      return Promise.resolve('Important.')
    })
    priorities.setOn(true)
    const key = 'c'
    expect(await priorities.heard(key, 'Lunch', [said('at noon?', 5)])).toBe('important')
    expect(await priorities.heard(key, 'Lunch', [said('at noon?', 5)])).toBe('important')
    expect(asks).toHaveLength(1)
    expect(await priorities.heard(key, 'Lunch', [said('ok', 6, true)])).toBeNull()
    expect(new Priorities().levelOf(key)).toBe('important')
  })

  test("the reader's level is kept and taught to the next ask", async () => {
    const priorities = new Priorities()
    let last = ''
    priorities.useAsker(() => (messages) => {
      last = messages[0]?.content ?? ''
      return Promise.resolve('unimportant')
    })
    priorities.setOn(true)
    const key = 'c'
    priorities.reassign(key, 'urgent', { title: 'Server down', from: 'Ops', words: 'prod is down' })
    expect(priorities.levelOf(key)).toBe('urgent')
    await priorities.heard('d', 'Other', [said('hi', 9)])
    expect(last).toContain('"Server down" from Ops: "prod is down" -> urgent')
    expect(new Priorities().lessons).toHaveLength(1)
  })

  test("an Orden chat's level kept before is read back under the chat, and other services' go", () => {
    localStorage.setItem(
      'orden:chat-priorities',
      JSON.stringify({
        on: true,
        assigned: {
          'orden\norden\nc': { level: 'urgent', by: 'ai', at: 1 },
          'mail\na@x.org\nd': { level: 'important', by: 'ai', at: 2 },
        },
      }),
    )
    const priorities = new Priorities()
    expect(priorities.assigned).toEqual({ c: { level: 'urgent', by: 'ai', at: 1 } })
    expect(priorities.levelOf('c')).toBe('urgent')
  })
})

describe('drafts and actions', () => {
  test('off by default; on, a reply and a task are suggested once per message', async () => {
    const priorities = new Priorities()
    let asked = 0
    let style = ''
    priorities.useAsker(() => (messages) => {
      asked++
      style = messages[0]?.content ?? ''
      return Promise.resolve('{"reply":"jo, 12i","todo":{"title":"Book a table","priority":2}}')
    })
    const key = 'c'
    expect(await priorities.suggest(key, 'Lunch', [said('noon?', 3)], [], '2026-11-06')).toBeNull()
    priorities.setDrafting(true)
    const found = await priorities.suggest(
      key,
      'Lunch',
      [said('noon?', 3)],
      ['jo passt'],
      '2026-11-06',
    )
    expect(found).toEqual({ reply: 'jo, 12i', todo: { title: 'Book a table', priority: 2 } })
    await priorities.suggest(key, 'Lunch', [said('noon?', 3)], [], '2026-11-06')
    expect(asked).toBe(1)
    expect(style).toContain('- jo passt')
    expect(new Priorities().drafting).toBe(true)

    priorities.settle(key, 'reply')
    expect(priorities.suggestions[key]).toMatchObject({
      reply: null,
      todo: { title: 'Book a table' },
    })
    priorities.settle(key, 'todo')
    expect(priorities.suggestions[key]).toBeUndefined()
  })

  test('switched off, every suggestion goes', async () => {
    const priorities = new Priorities()
    priorities.useAsker(() => () => Promise.resolve('{"reply":"ok","todo":null}'))
    priorities.setDrafting(true)
    await priorities.suggest('k', 'T', [said('hi', 1)], [], '2026-11-06')
    expect(Object.keys(priorities.suggestions)).toEqual(['k'])
    priorities.setDrafting(false)
    expect(priorities.suggestions).toEqual({})
  })
})
