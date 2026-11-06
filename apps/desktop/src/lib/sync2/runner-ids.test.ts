import { describe, expect, test, vi } from 'vitest'
import type { Engine } from './engine'

vi.stubGlobal('localStorage', {
  length: 0,
  key: () => null,
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
})

const { idIn, runner } = await import('./runner.svelte')

function engine(role: string | null, entry: { id: string } | null, inside = true): Engine {
  return {
    placed: () => (inside ? { space: { row: { role } }, path: 'Notepad.application' } : null),
    entryAt: () => entry,
  } as unknown as Engine
}

interface Open {
  current: unknown
  accountId: string | null
  leaderId: string | null
  reconciledAt: number
  ask(what: string, args: Record<string, unknown>): Promise<unknown>
  answering(said: { what: string; args: Record<string, unknown> }): Promise<unknown>
}

describe('the id sync gave a file', () => {
  test('is said with whether its space is the reader’s own, or why there is none', () => {
    const path = '/s/Notepad.application'
    expect(idIn(engine('owner', { id: 'a1' }), path, true)).toEqual({ id: 'a1', own: true })
    expect(idIn(engine(null, { id: 'a1' }), path, true)).toEqual({ id: 'a1', own: true })
    expect(idIn(engine('write', { id: 'a1' }), path, true)).toEqual({ id: 'a1', own: false })
    expect(idIn(engine('owner', null), path, true)).toEqual({ none: 'untaken' })
    expect(idIn(engine('owner', null, false), path, true)).toEqual({ none: 'outside' })
    expect(idIn(engine('owner', null, false), path, false)).toEqual({ none: 'not-running' })
  })

  test('is asked of the window running sync by one that does not run it', async () => {
    const open = runner as unknown as Open
    const asked: unknown[] = []
    open.current = null
    open.accountId = 'account'
    open.leaderId = null
    expect(await runner.idAt('/s/Notepad.application')).toEqual({ none: 'not-running' })
    open.leaderId = 'window-2'
    open.ask = (what, args) => {
      asked.push([what, args])
      return Promise.resolve({ id: 'a1', own: true })
    }
    expect(await runner.idAt('/s/Notepad.application')).toEqual({ id: 'a1', own: true })
    expect(asked).toEqual([['id-at', { path: '/s/Notepad.application' }]])
    open.ask = () => Promise.resolve(null)
    expect(await runner.idAt('/s/Notepad.application')).toEqual({ none: 'not-running' })
  })

  test('is answered by the window running sync', async () => {
    const open = runner as unknown as Open
    open.current = engine('owner', { id: 'a1' })
    open.reconciledAt = 1
    expect(
      await open.answering({ what: 'id-at', args: { path: '/s/Notepad.application' } }),
    ).toEqual({ id: 'a1', own: true })
    open.current = null
  })
})
