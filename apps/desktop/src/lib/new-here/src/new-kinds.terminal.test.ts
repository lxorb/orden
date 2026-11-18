import { providePort } from '@orden/contracts'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())

const opened: (string | undefined)[] = []

vi.mock('../../platform/src/tauri', async (actual) => ({
  ...(await actual<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
}))
const shownPicker: (string | undefined)[] = []
providePort('terminal.making', {
  open: (shell) => {
    opened.push(shell)
    return Promise.resolve()
  },
  shells: (open) =>
    Promise.resolve([
      { label: 'PowerShell', checked: true, run: () => open('pwsh') },
      { label: 'Ubuntu', run: () => open('wsl:Ubuntu') },
    ]),
  warm: () => Promise.resolve(),
  pickHost: (pane) => {
    shownPicker.push(pane)
    return Promise.resolve()
  },
  online: () => Promise.resolve(),
})

const { kindLines, newKinds } = await import('./new-kinds')
const { APPS_WORD, EXPERIMENTAL_WORD, EXPLORER_WORD, hiddenKinds, PASS_WORD } =
  await import('../../gates/src/api')
hiddenKinds.hidden = [EXPERIMENTAL_WORD, APPS_WORD, EXPLORER_WORD, PASS_WORD]

const terminalKind = () => newKinds().find((one) => one.kind === 'terminal')
const { workspace } = await import('../../workspace/src/api')
const { viewport } = await import('../../ui-kit/src/viewport.svelte')

afterEach(() => {
  opened.length = 0
  vi.restoreAllMocks()
})

describe('a terminal, as a kind a new tab can be', () => {
  test('starts the terminals, with Remote and Online after it', () => {
    expect(kindLines(newKinds()).map((line) => line.map((one) => one.kind))).toEqual([
      ['note', 'canvas', 'pages'],
      ['ai'],
      ['terminal', 'remote', 'online'],
      ['web', 'private'],
      ['application', 'explorer', 'pass'],
    ])
  })

  test('is left out, with Remote and Online, for somebody who does not write code, applications staying', async () => {
    const { modes } = await import('../../modes/src/api')
    modes.developer = false
    try {
      expect(kindLines(newKinds()).map((line) => line.map((one) => one.kind))).toEqual([
        ['note', 'canvas', 'pages'],
        ['ai'],
        ['web', 'private'],
        ['application', 'explorer', 'pass'],
      ])
    } finally {
      modes.developer = null
    }
  })

  test('on R, its own letter', () => {
    const letters = newKinds().map((one) => one.letter)
    expect(terminalKind()?.letter).toBe('r')
    expect(new Set(letters).size).toBe(letters.length)
  })

  test('wears the prompt, and is called what the palette calls it', () => {
    const terminal = terminalKind()
    expect(terminal?.mark).toBe('terminal')
    expect(terminal?.label()).toBe('New terminal')
  })

  test('whatever the window’s width', () => {
    const was = viewport.device
    viewport.device = 'phone'
    expect(newKinds().some((one) => one.kind === 'terminal')).toBe(true)
    viewport.device = was
  })

  test('makes the default shell when pressed, in the pane that asked', () => {
    const focused = vi.spyOn(workspace, 'focusPane').mockImplementation(() => undefined)
    terminalKind()?.make('a-pane')

    expect(opened).toEqual([undefined])
    expect(focused).toHaveBeenCalledWith('a-pane')
  })

  test('and any other shell a chevron away', async () => {
    const more = terminalKind()?.others
    expect(more).toBeDefined()

    const others = more ? await more() : []
    expect(others.map((one) => one?.label)).toEqual(['PowerShell', 'Ubuntu'])

    const ubuntu = others[1]
    if (ubuntu) ubuntu.run()
    expect(opened).toEqual(['wsl:Ubuntu'])
  })

  test('the other kinds have no chevron', () => {
    expect(
      newKinds()
        .filter((one) => one.kind !== 'terminal')
        .every((one) => one.others === undefined),
    ).toBe(true)
  })
})

describe('Remote, beside it', () => {
  test('on S, wearing the server, and opening the host picker for the pane that asked', async () => {
    const remote = newKinds().find((one) => one.kind === 'remote')
    expect(remote?.letter).toBe('s')
    expect(remote?.mark).toBe('remote')
    expect(remote?.label()).toBe('Remote')
    expect(remote?.others).toBeUndefined()

    remote?.make('a-pane')
    await vi.waitFor(() => expect(shownPicker).toEqual(['a-pane']))
    expect(opened).toEqual([])
  })
})
