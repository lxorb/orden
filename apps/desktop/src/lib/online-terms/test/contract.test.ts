import { describe, expect, test } from 'vitest'
import { isMadeName, isOnlineTab, MADE_NAME, termName } from '../src/api'

describe('the module stands on its own', () => {
  test('the made name is a word a person reads', () => {
    expect(MADE_NAME).toBe('Terminal')
  })
})
describe('an online terminal', () => {
  test('is only ever a terminal, and is told by its .term file', () => {
    expect(isOnlineTab({ kind: 'note', path: 'a.term' })).toBe(false)
    expect(isOnlineTab({ kind: 'terminal', path: null, doc: '{"shell":"zsh"}' })).toBe(false)
  })
  test('is shown without its ending, and a made name is told from a chosen one', () => {
    expect(termName('Build.term')).toBe('Build')
    expect(isMadeName('Terminal 2.term')).toBe(true)
    expect(isMadeName('Build')).toBe(false)
  })
})
