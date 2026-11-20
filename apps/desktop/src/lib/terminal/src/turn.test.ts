import { beforeEach, describe, expect, test, vi } from 'vitest'

const on = vi.hoisted(() => ({ explorer: true, twins: new Map<string, { kind: string }>(), turned: [] as unknown[][] }))
vi.mock('../../gates/src/api', () => ({ explorerOn: () => on.explorer }))
vi.mock('../../workspace/src/api', () => ({
  workspace: {
    activeSpace: { root: '/spaces/Lab' },
    twinOf: (id: string) => on.twins.get(id) ?? null,
    turn: (...args: unknown[]) => void on.turned.push(args),
  },
}))
const { turnable, turnLabel, turnTerminal } = await import('./turn')
const term = (doc: string, path: string | null = null) => ({ id: 't1', kind: 'terminal', path, doc }) as never
const local = term(JSON.stringify({ shell: 'bash', folder: '/spaces/Lab/src', key: 'k' }))
beforeEach(() => {
  on.explorer = true
  on.twins.clear()
  on.turned = []
})
describe('a terminal turned into its file explorer (#2274)', () => {
  test('offers the turn for a shell on this computer, while the explorer is on', () => {
    expect(turnable(local)).toBe(true)
    expect(turnable(term(JSON.stringify({ shell: 'ssh:host1', folder: null, key: 'k' })))).toBe(false)
    expect(turnable(term(JSON.stringify({ shell: 'wsl:Ubuntu', folder: null, key: 'k' })))).toBe(false)
    expect(turnable(term('', '/spaces/Lab/Box.term'))).toBe(false)
    on.explorer = false
    expect(turnable(local)).toBe(false)
  })
  test('opens the explorer in the folder the shell is in, and turns back to its twin', () => {
    expect(turnLabel(local)).toBe('Show in file explorer')
    turnTerminal(local)
    expect(on.turned).toEqual([
      [
        't1',
        { kind: 'explorer', words: JSON.stringify({ folder: '/spaces/Lab/src', back: [], ahead: [] }), title: 'src' },
      ],
    ])
    on.twins.set('t1', { kind: 'explorer' })
    expect(turnLabel(local)).toBe('Back to the file explorer')
    turnTerminal(local)
    expect(on.turned.at(-1)).toEqual(['t1'])
  })
})
