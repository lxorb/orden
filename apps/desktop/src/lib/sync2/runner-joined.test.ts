import { describe, expect, test, vi } from 'vitest'
import type { NoteDoc } from '../workspace/documents.svelte'

vi.stubGlobal('localStorage', {
  length: 0,
  key: () => null,
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
})

const { runner } = await import('./runner.svelte')

describe('a note on its way to its document', () => {
  test('is not joined until it has', () => {
    const doc = { live: true, text: () => 'words', write: () => undefined }
    const open = runner as unknown as {
      current: unknown
      bound: Map<string, { id: string; part: () => void; joining?: boolean }>
    }
    open.current = {
      entryAt: () => ({ id: 'n1' }),
      core: {
        isHeld: () => false,
        docs: new Map([['n1', doc]]),
        pinned: new Set(['n1']),
      },
    }
    const note = { path: '/s/a.md' } as unknown as NoteDoc

    open.bound.set('k', { id: 'n1', part: () => undefined, joining: true })
    expect(runner.joinedOf(note)).toBeNull()

    open.bound.set('k', { id: 'n1', part: () => undefined })
    expect(runner.joinedOf(note)?.text()).toBe('words')

    open.bound.clear()
    open.current = null
  })
})
