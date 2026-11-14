import { beforeEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

const answers: unknown[] = []
const invoke = vi.fn((command: string) => {
  if (command !== 'terminal_shells') return Promise.reject(new Error(command))
  return answers.length ? Promise.resolve(answers.shift()) : Promise.reject(new Error('no crate'))
})

vi.mock('../../platform/src/tauri', () => ({ isDesktop: true, invoke }))

const { shellName, shells, SIZES, waysOf } = await import('./shells.svelte')

beforeEach(() => {
  invoke.mockClear()
  answers.length = 0
})

describe('the shells', () => {
  test('are asked for once, and read rather than trusted', async () => {
    answers.push([
      { id: 'pwsh', name: 'PowerShell' },
      { id: 'cmd', name: 'Command Prompt' },
      { id: 3, name: 'broken' },
      'nonsense',
    ])

    const found = await shells.ask()
    await shells.ask()

    expect(found.map((one) => one.id)).toEqual(['pwsh', 'cmd'])
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  test('open the chosen one, and the platform’s own otherwise', () => {
    expect(shells.chosen?.id).toBe('pwsh')

    shells.choose('cmd')
    expect(shells.chosen?.id).toBe('cmd')
    expect(store.get('orden:terminal-shell')).toBe('cmd')

    shells.choose('wsl:Gone')
    expect(shells.chosen?.id).toBe('pwsh')
  })

  test('Command Prompt is called what Windows calls it, the rest their own names', () => {
    expect(shellName({ id: 'cmd', name: 'Command Prompt' })).toBe('Command Prompt')
    expect(shellName({ id: '/bin/zsh', name: 'zsh' })).toBe('zsh')
  })

  test('the type size stays inside what Settings offers', () => {
    shells.setSize(100)
    expect(shells.size).toBe(SIZES.most)
    shells.setSize(1)
    expect(shells.size).toBe(SIZES.least)
    shells.setSize(14.4)
    expect(shells.size).toBe(14)
    expect(store.get('orden:terminal-size')).toBe('14')
  })
})

describe('the keys that are both', () => {
  test('are asked about until somebody answers, and the answer is kept', () => {
    expect(shells.ways['app.scratchpad']).toBeUndefined()

    shells.setWay('app.scratchpad', 'shell')
    expect(shells.ways['app.scratchpad']).toBe('shell')
    expect(JSON.parse(store.get('orden:terminal-keys') ?? '{}')).toEqual({
      'app.scratchpad': 'shell',
    })

    shells.setWay('app.scratchpad', null)
    expect(shells.ways['app.scratchpad']).toBeUndefined()
    expect(JSON.parse(store.get('orden:terminal-keys') ?? '{}')).toEqual({})
  })

  test('are read rather than trusted', () => {
    expect(waysOf({ 'app.new-kind': 'app', 'app.scratchpad': 'shell', other: 'both' })).toEqual({
      'app.new-kind': 'app',
      'app.scratchpad': 'shell',
    })
    expect(waysOf(['app'])).toEqual({})
    expect(waysOf(null)).toEqual({})
  })
})
