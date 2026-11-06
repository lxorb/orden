import type { ILink, ILinkProvider } from '@xterm/xterm'
import { afterEach, expect, test, vi } from 'vitest'

const ADDRESS = 'https://claude.ai/oauth/authorize?scope=user%3Aprofile+user%3Amcp_servers'

const made: { providers: ILinkProvider[]; options: Record<string, unknown> }[] = []

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 40
    rows = 24
    unicode = { activeVersion: '' }
    parser = { registerOscHandler: () => ({ dispose: () => undefined }) }
    readonly providers: ILinkProvider[] = []
    buffer = {
      active: {
        getNullCell: () => ({ chars: '', getChars: () => '', getWidth: () => 1 }),
        getLine: (y: number) => {
          const text = [ADDRESS.slice(0, 40), ADDRESS.slice(40).padEnd(40)][y]
          if (text === undefined) return undefined
          return {
            isWrapped: false,
            length: 40,
            getCell: (x: number, cell: { getChars: () => string }) => {
              const char = text[x] === ' ' ? '' : (text[x] ?? '')
              cell.getChars = () => char
              return cell
            },
          }
        },
      },
    }
    constructor(readonly options: Record<string, unknown>) {
      made.push({ providers: this.providers, options })
    }
    registerLinkProvider(provider: ILinkProvider) {
      this.providers.push(provider)
      return { dispose: () => undefined }
    }
    loadAddon = () => undefined
    onData = () => undefined
    onBinary = () => undefined
    onTitleChange = () => undefined
    onBell = () => undefined
    onResize = () => undefined
    attachCustomKeyEventHandler = () => undefined
    getSelectionPosition = () => undefined
    getSelection = () => ''
    hasSelection = () => false
  },
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = () => undefined
  },
}))
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    onDidChangeResults = () => undefined
  },
}))
vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: class {
    serialize = () => ''
  },
}))
vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: class {
    activate = () => undefined
  },
}))

globalThis.ResizeObserver = class {
  observe() {
    // Nothing is measured here.
  }
  unobserve() {
    // Said above.
  }
  disconnect() {
    // Said above.
  }
}

const { sessionOf } = await import('../../src/lib/terminal/sessions.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { NoteDoc, Tab } = await import('../../src/lib/workspace/documents.svelte')

afterEach(() => {
  made.length = 0
  vi.restoreAllMocks()
})

function linksOf(provider: ILinkProvider | undefined, y: number): ILink[] {
  let found: ILink[] = []
  provider?.provideLinks(y, (links) => {
    found = links ?? []
  })
  return found
}

const ctrl = () => new MouseEvent('click', { ctrlKey: true, metaKey: true })

function press(screen: HTMLElement, held: MouseEventInit) {
  for (const type of ['mousedown', 'mouseup', 'click'] as const) {
    screen.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...held }))
  }
}

for (const [where, path, name] of [
  ['local', null, 'PowerShell'],
  ['online', 'Work/Terminal.term', 'Terminal.term'],
] as const) {
  test(`a ${where} terminal follows the whole address a program broke over rows`, () => {
    const opened = vi.spyOn(workspace, 'openPage').mockReturnValue(null)
    const text = JSON.stringify({ shell: 'pwsh', folder: null, key: where })
    const tab = new Tab(
      new NoteDoc({ kind: 'terminal', path, name, text, dirty: false }, () => undefined),
      'pane',
    )
    sessionOf(tab)
    const [screen] = made
    expect(screen?.providers).toHaveLength(1)

    for (const y of [1, 2]) {
      const [link] = linksOf(screen?.providers[0], y)
      expect(link?.text).toBe(ADDRESS)
      expect(link?.range).toEqual({ start: { x: 1, y: 1 }, end: { x: ADDRESS.length - 40, y: 2 } })
    }

    const [link] = linksOf(screen?.providers[0], 2)
    link?.activate(ctrl(), ADDRESS)
    expect(opened).not.toHaveBeenCalled()

    const session = sessionOf(tab)
    const drawn = document.createElement('div')
    session.host.append(drawn)
    document.body.append(session.host)
    const heard: string[] = []
    for (const type of ['mousedown', 'mouseup', 'click']) {
      drawn.addEventListener(type, () => heard.push(type))
    }

    link?.hover?.(new MouseEvent('mousemove'), ADDRESS)
    press(drawn, {})
    expect(opened).not.toHaveBeenCalled()
    expect(heard).toEqual(['mousedown', 'mouseup', 'click'])

    heard.length = 0
    press(drawn, { ctrlKey: true, metaKey: true })
    expect(opened).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledWith(ADDRESS, 'behind', tab.id)
    expect(heard).toEqual([])

    opened.mockClear()
    press(drawn, { button: 1 })
    expect(opened).toHaveBeenCalledTimes(1)
    expect(heard).toEqual([])

    link?.leave?.(new MouseEvent('mouseleave'), ADDRESS)
    opened.mockClear()
    press(drawn, { ctrlKey: true, metaKey: true })
    expect(opened).not.toHaveBeenCalled()
    expect(heard).toEqual(['mousedown', 'mouseup', 'click'])

    heard.length = 0
    const handler = screen?.options.linkHandler as {
      activate: (e: MouseEvent, uri: string) => void
      hover: (e: MouseEvent, uri: string) => void
    }
    handler.activate(ctrl(), ADDRESS)
    expect(opened).not.toHaveBeenCalled()
    handler.hover(new MouseEvent('mousemove'), ADDRESS)
    press(drawn, { ctrlKey: true, metaKey: true })
    expect(opened).toHaveBeenCalledTimes(1)
    expect(heard).toEqual([])
    session.host.remove()
  })
}
