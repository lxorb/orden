import { describe, expect, test } from 'vitest'
import { spokenTask, Today, type TodayHost } from './today'

function host(found = true) {
  const ticked: [string, boolean][] = []
  let drawn = 0
  const answer: TodayHost = {
    load: () =>
      Promise.resolve([
        { at: 'a1', text: 'Call Mum' },
        { at: 'b2', text: 'Send the slides' },
        { at: 'c3', text: 'milk \\$3' },
      ]),
    tick: (id, done) => {
      ticked.push([id, done])
      return Promise.resolve(found)
    },
    redraw: () => {
      drawn += 1
    },
  }
  return { answer, ticked, drawn: () => drawn }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('today on the glasses', () => {
  test('a box in front of each task, drawn once it is read', async () => {
    const { answer, drawn } = host()
    const today = new Today(answer)
    today.fresh()
    await settled()
    expect(today.rows().map((one) => one.label)).toEqual([
      '□ Call Mum',
      '□ Send the slides',
      '□ milk $3',
    ])
    expect(drawn()).toBe(1)
  })

  test('a tap fills the box at once and ticks the todo; a second tap unticks it', async () => {
    const { answer, ticked } = host()
    const today = new Today(answer)
    today.fresh()
    await settled()
    const id = today.rows()[1]?.id ?? ''
    today.tick(id)
    expect(today.rows()[1]?.label).toBe('■ Send the slides')
    today.tick(id)
    await settled()
    expect(ticked).toEqual([
      ['b2', true],
      ['b2', false],
    ])
    expect(today.rows()[1]?.label).toBe('□ Send the slides')
  })

  test('a todo that is gone is put back', async () => {
    const { answer } = host(false)
    const today = new Today(answer)
    today.fresh()
    await settled()
    today.tick(today.rows()[0]?.id ?? '')
    await settled()
    expect(today.rows()[0]?.label).toBe('□ Call Mum')
  })

  test('a todo that could not be ticked is put back too', async () => {
    const { answer, drawn } = host()
    const today = new Today({ ...answer, tick: () => Promise.reject(new Error('offline')) })
    today.fresh()
    await settled()
    today.tick(today.rows()[0]?.id ?? '')
    await settled()
    expect(today.rows()[0]?.label).toBe('□ Call Mum')
    expect(drawn()).toBe(2)
  })

  test('what was said after the word, its capitals kept', () => {
    expect(spokenTask('Task, call Mum tomorrow at four.')).toBe('call Mum tomorrow at four')
    expect(spokenTask('Aufgabe: Milch kaufen')).toBe('Milch kaufen')
  })

  test('opened twice quickly, it shows what the later reading found, whichever answers last', async () => {
    const answers: ((tasks: { at: string; text: string }[]) => void)[] = []
    const today = new Today({
      load: () => new Promise((done) => answers.push(done)),
      tick: () => Promise.resolve(false),
      redraw: () => undefined,
    })
    today.fresh()
    today.fresh()
    answers[1]?.([{ at: 'a1', text: 'Now' }])
    await settled()
    answers[0]?.([{ at: 'b2', text: 'Before' }])
    await settled()
    expect(today.rows().map((one) => one.label)).toEqual(['□ Now'])
  })
})
