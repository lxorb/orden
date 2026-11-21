import { render } from 'svelte/server'
import { describe, expect, test } from 'vitest'
import { Mascot } from '../src/api'

describe('the mascot', () => {
  test('draws a mood as its face, hidden from screen readers', () => {
    const body = render(Mascot, { props: { mood: 'happy' } }).body
    expect(body).toContain('( ͡° ͜ʖ ͡°)')
    expect(body).toContain('aria-hidden="true"')
  })
  test('names itself when given a label', () => {
    const body = render(Mascot, { props: { mood: 'crying', label: 'Import failed', size: 56 } }).body
    expect(body).toContain('( ͡ಥ ͜ʖ ͡ಥ)')
    expect(body).toContain('role="img"')
    expect(body).toContain('aria-label="Import failed"')
    expect(body).toContain('font-size: 56px')
  })
  test('knows the moods the import tab shows', () => {
    for (const mood of ['happy', 'unsure', 'crying'] as const) {
      expect(render(Mascot, { props: { mood } }).body).toContain('ʖ')
    }
  })
})
