import { describe, expect, test } from 'vitest'
import { spokenTask, Today, type TodayHost } from './today'

function host(found = true, moves: Record<string, string> = {}, takesBack = false) {
  const ticked: [string, string, boolean][] = []
  const backs: string[] = []
  let drawn = 0
  const answer: TodayHost = {
    load: () =>
      Promise.resolve([
        { at: 'Inbox.md#0:a1', space: 'Home', text: 'Call Mum' },
        { at: 'Work.md#3:b2', space: 'Work', text: 'Send the slides' },
        { at: 'Shop.md#1:c3', space: 'Home', text: 'milk \\$3' },
      ]),
    tick: (at, space, done) => {
      ticked.push([at, space, done])
      const back = () => {
        backs.push(at)
        return Promise.resolve(takesBack)
      }
      return Promise.resolve(found ? { at: (done ? moves[at] : undefined) ?? at, back } : null)
    },
    redraw: () => {
      drawn += 1
    },
  }
  return { answer, ticked, backs, drawn: () => drawn }
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

  test('a tap fills the box at once and ticks it in its note; a second tap opens it', async () => {
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
      ['Work.md#3:b2', 'Work', true],
      ['Work.md#3:b2', 'Work', false],
    ])
    expect(today.rows()[1]?.label).toBe('□ Send the slides')
  })

  test('a second tap unticks the task where the tick left it, not the repeat it made', async () => {
    const { answer, ticked } = host(true, { 'Work.md#3:b2': 'Work.md#4:b2' })
    const today = new Today(answer)
    today.fresh()
    await settled()
    const id = today.rows()[1]?.id ?? ''
    today.tick(id)
    today.tick(id)
    await settled()
    today.tick(id)
    await settled()
    expect(ticked).toEqual([
      ['Work.md#3:b2', 'Work', true],
      ['Work.md#4:b2', 'Work', false],
      ['Work.md#4:b2', 'Work', true],
    ])
    expect(today.rows()[1]?.label).toBe('■ Send the slides')
  })

  test('a second tap takes the tick back whole when the note is as the tick left it', async () => {
    const { answer, ticked, backs } = host(true, { 'Work.md#3:b2': 'Work.md#4:b2' }, true)
    const today = new Today(answer)
    today.fresh()
    await settled()
    const id = today.rows()[1]?.id ?? ''
    today.tick(id)
    today.tick(id)
    await settled()
    today.tick(id)
    await settled()
    expect(backs).toEqual(['Work.md#3:b2'])
    expect(ticked).toEqual([
      ['Work.md#3:b2', 'Work', true],
      ['Work.md#3:b2', 'Work', true],
    ])
  })

  test('a task the note no longer has is put back', async () => {
    const { answer } = host(false)
    const today = new Today(answer)
    today.fresh()
    await settled()
    today.tick(today.rows()[0]?.id ?? '')
    await settled()
    expect(today.rows()[0]?.label).toBe('□ Call Mum')
  })

  test('a task that could not be ticked, the note not written, is put back too', async () => {
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
    const answers: ((tasks: { at: string; space: string; text: string }[]) => void)[] = []
    const today = new Today({
      load: () => new Promise((done) => answers.push(done)),
      tick: () => Promise.resolve(null),
      redraw: () => undefined,
    })
    today.fresh()
    today.fresh()
    answers[1]?.([{ at: 'Inbox.md#0:a1', space: 'Home', text: 'Now' }])
    await settled()
    answers[0]?.([{ at: 'Inbox.md#0:b2', space: 'Home', text: 'Before' }])
    await settled()
    expect(today.rows().map((one) => one.label)).toEqual(['□ Now'])
  })
})
