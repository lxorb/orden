import { describe, expect, test } from 'vitest'
import { providePort, type Stopping } from '@orden/contracts'
import { answerQuitting, asWarning, holdToQuit, mayStop, quitAsk, quitAsked } from '../src/api'
import { asks, rowsHere, showRow } from '../src/rows'

describe('the module stands on its own', () => {
  test('asks, answers the other windows and quits through doors', () => {
    for (const one of [mayStop, quitAsked, answerQuitting, holdToQuit]) expect(typeof one).toBe('function')
  })
})

const row = (kind: Stopping['kind'], id: string, busy: boolean): Stopping => ({
  window: 'main',
  kind,
  id,
  name: id,
  busy,
})

describe('the warning before quitting', () => {
  test('falls back to warning while something runs', () => {
    expect(asWarning('nonsense')).toBe('running')
    expect(asWarning('always')).toBe('always')
  })

  test('asks never, always when anything would stop, or only while one is busy', () => {
    const idle = [row('terminal', 'a', false)]
    const busy = [...idle, row('thread', 'b', true)]
    expect(asks('never', busy)).toBe(false)
    expect(asks('always', idle)).toBe(true)
    expect(asks('always', [])).toBe(false)
    expect(asks('running', idle)).toBe(false)
    expect(asks('running', busy)).toBe(true)
  })

  test("Don't ask again turns it off once quitting goes on", async () => {
    quitAsk.warnWhen('running')
    const answered = quitAsk.ask('quit', [row('terminal', 'a', true)])
    quitAsk.never = true
    quitAsk.answer('go')
    expect(await answered).toBe('go')
    expect(quitAsk.warning).toBe('never')
    quitAsk.warnWhen('running')
  })
})

describe('what quitting would stop', () => {
  test('is every port of every kind, terminals first, and nothing from a kind none provides', async () => {
    expect(await rowsHere('main', false)).toEqual([])
    const shown: string[] = []
    const unbind = [
      providePort('quit.thread', {
        rows: (window) => Promise.resolve([{ ...row('thread', 'b', true), window }]),
        show: (one) => {
          shown.push(one.id)
          return Promise.resolve()
        },
      }),
      providePort('quit.terminal', {
        rows: (_window, idle) => Promise.resolve(idle ? [row('terminal', 'a', false)] : []),
        show: () => Promise.resolve(),
      }),
    ]
    expect((await rowsHere('two', true)).map((one) => [one.kind, one.window])).toEqual([
      ['terminal', 'main'],
      ['thread', 'two'],
    ])
    await showRow(row('thread', 'b', true))
    expect(shown).toEqual(['b'])
    for (const one of unbind) one()
  })
})
