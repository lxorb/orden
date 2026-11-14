import { afterEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})

const opened: (string | undefined)[] = []

vi.mock('./platform/src/tauri', async (actual) => ({
  ...(await actual<typeof import('./platform/src/tauri')>()),
  isDesktop: true,
}))
vi.mock('./terminal/src/open', () => ({
  openTerminal: (shell?: string) => {
    opened.push(shell)
    return Promise.resolve()
  },
  shellRows: (make: (shell: { id: string; name: string }) => void) =>
    Promise.resolve([
      { label: 'PowerShell', checked: true, run: () => make({ id: 'pwsh', name: 'PowerShell' }) },
      { label: 'Ubuntu', run: () => make({ id: 'wsl:Ubuntu', name: 'Ubuntu' }) },
    ]),
}))

const shownPicker: (string | undefined)[] = []
vi.mock('./terminal/src/remote/picker.svelte', () => ({
  hostPicker: { show: (paneId?: string) => void shownPicker.push(paneId) },
}))

const { kindLines, newKinds } = await import('./new-kinds')
const { APPS_WORD, EXPERIMENTAL_WORD, EXPLORER_WORD, hiddenKinds, PASS_WORD } =
  await import('./settings.svelte')
hiddenKinds.hidden = [EXPERIMENTAL_WORD, APPS_WORD, EXPLORER_WORD, PASS_WORD]

const terminalKind = () => newKinds().find((one) => one.kind === 'terminal')
const { workspace } = await import('./workspace.svelte')
const { viewport } = await import('./ui-kit/src/viewport.svelte')

afterEach(() => {
  opened.length = 0
  vi.restoreAllMocks()
})

describe('a terminal, as a kind a new tab can be', () => {
  test('starts the second line, with Remote and Online after it', () => {
    expect(kindLines(newKinds()).map((line) => line.map((one) => one.kind))).toEqual([
      ['note', 'canvas', 'pages'],
      ['terminal', 'remote', 'online', 'application', 'explorer', 'pass'],
      ['web', 'private'],
    ])
  })

  test('is left out, with Remote and Online, for somebody who does not write code, applications staying', async () => {
    const { modes } = await import('./modes.svelte')
    modes.developer = false
    try {
      expect(kindLines(newKinds()).map((line) => line.map((one) => one.kind))).toEqual([
        ['note', 'canvas', 'pages'],
        ['application', 'explorer', 'pass'],
        ['web', 'private'],
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
