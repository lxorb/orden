import { describe, expect, test, vi } from 'vitest'

vi.mock('../../../workspace/src/api', () => ({
  workspace: { documents: [{ key: 'k1', name: 'Plan.canvas' }] },
}))
const { titleOf } = await import('./words')
describe('a changed file’s title (#2310)', () => {
  test('never shows Orden’s own ending, and keeps a real file’s', () => {
    expect(titleOf('/s/Work/Herons.md')).toBe('Herons')
    expect(titleOf('/s/Work/Board.canvas')).toBe('Board')
    expect(titleOf('/s/Work/Deck.pages')).toBe('Deck')
    expect(titleOf('/s/Work/Shell.term')).toBe('Shell')
    expect(titleOf('/s/Work/Report.pdf')).toBe('Report.pdf')
  })
  test('of an unsaved file is its name without Orden’s ending', () => {
    expect(titleOf('unsaved:k1')).toBe('Plan')
    expect(titleOf('unsaved:gone')).toBe('')
  })
})
