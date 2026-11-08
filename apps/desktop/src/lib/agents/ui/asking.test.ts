import { describe, expect, test } from 'vitest'
import { asking } from './asking.svelte'

const question = (agent: string) => ({
  agent,
  kind: 'text' as const,
  message: 'Which one?',
  choices: [],
  placeholder: null,
})

describe('the reader’s questions', () => {
  test('an agent that is gone leaves nothing behind once its last wait has heard', async () => {
    const answered = asking.ask(question('gone'))
    const open = asking.ask(question('gone'))
    const kept = asking.ask(question('here'))
    asking.answer(answered.id, 'this one')
    asking.answer(kept.id, 'that one')

    asking.keepOnly(new Set(['here']))

    expect(asking.of('gone')).toEqual([])
    expect(asking.knows('gone', answered.id)).toBe(false)
    expect(await asking.heard(answered.id, 0)).toBeNull()
    expect(asking.knows('gone', open.id)).toBe(true)

    asking.keepOnly(new Set(['here']))

    expect(asking.knows('gone', open.id)).toBe(false)
    expect(await asking.heard(open.id, 0)).toBeNull()
    expect(asking.knows('here', kept.id)).toBe(true)
    expect(await asking.heard(kept.id, 0)).toEqual({ answer: 'that one' })
  })
})
