import { afterEach, describe, expect, test, vi } from 'vitest'
import { shortcuts } from '../../../shortcuts/src/api'
import { answerByKeys, latestAsked } from './asked-keys'

const asking = (approval: string) => ({
  kind: 'tool',
  id: approval,
  verb: 'edit_note',
  args: {},
  state: 'asking',
  result: { text: '', images: [], error: false, approval },
})
const turns = [
  { id: 't1', role: 'model', parts: [asking('q1'), { kind: 'text', text: 'Then ' }] },
  { id: 't2', role: 'you', parts: [] },
  {
    id: 't3',
    role: 'model',
    parts: [asking('q2'), { kind: 'tool', id: 'd', verb: 'read_note', args: {}, state: 'ok' }],
  },
] as never
afterEach(() => {
  shortcuts.reset('ai.approve')
  shortcuts.reset('ai.deny')
})
function pressed(key: string, altKey = true) {
  return new KeyboardEvent('keydown', { key, altKey, cancelable: true, bubbles: true })
}
describe('the keys that answer what the AI asks (#2427)', () => {
  test('answer the newest question still waiting, Approve with one and Deny with the other', () => {
    shortcuts.set('ai.approve', 'Alt-j')
    shortcuts.set('ai.deny', 'Alt-k')
    expect(latestAsked(turns)).toBe('q2')
    const answered: [string, boolean][] = []
    const answer = (id: string, allow: boolean) => answered.push([id, allow])
    const approve = pressed('j')
    expect(answerByKeys(approve, turns, answer)).toBe(true)
    expect(approve.defaultPrevented).toBe(true)
    expect(answerByKeys(pressed('k'), turns, answer)).toBe(true)
    expect(answered).toEqual([
      ['q2', true],
      ['q2', false],
    ])
  })
  test('let the key through when nothing waits for an answer', () => {
    shortcuts.set('ai.approve', 'Alt-j')
    const answer = vi.fn()
    const event = pressed('j')
    expect(answerByKeys(event, [{ id: 't', role: 'model', parts: [] }] as never, answer)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(answer).not.toHaveBeenCalled()
    expect(answerByKeys(pressed('x'), turns, answer)).toBe(false)
  })
})
