import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'

const calls = vi.hoisted(() => [] as string[])
vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  invoke: () => Promise.resolve(null),
  currentWindow: () =>
    Promise.resolve({
      isFullscreen: () => Promise.resolve(false),
      onResized: () => Promise.resolve(() => undefined),
    }),
}))
vi.mock('@tauri-apps/api/window', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/window')>()),
  getCurrentWindow: () => ({
    label: 'main',
    isFocused: () => Promise.resolve(true),
    onFocusChanged: () => Promise.resolve(() => undefined),
  }),
  getAllWindows: () => Promise.resolve([]),
}))
vi.mock('@tauri-apps/api/menu', () => {
  const said = (line: string) => {
    calls.push(line)
    return Promise.resolve()
  }
  class Native {
    constructor(readonly id: string) {}
    setText = (text: string) => said(`text ${this.id} ${text}`)
    setEnabled = (on: boolean) => said(`enabled ${this.id} ${on}`)
    setChecked = (on: boolean) => said(`checked ${this.id} ${on}`)
    setAccelerator = (key: string | null) => said(`accelerator ${this.id} ${key}`)
    append = () => said(`append ${this.id}`)
    remove = () => said(`remove ${this.id}`)
    setAsHelpMenuForNSApp = () => said('help menu')
    setAsWindowsMenuForNSApp = () => said('windows menu')
    close = () => Promise.resolve()
  }
  const made =
    (kind: string) =>
    async (options: { id?: string }): Promise<Native> => {
      calls.push(`new ${kind}`)
      return new Native(options.id ?? kind)
    }
  return {
    MenuItem: { new: made('item') },
    CheckMenuItem: { new: made('check') },
    PredefinedMenuItem: { new: made('system') },
    Submenu: { new: made('submenu') },
    Menu: {
      new: async () => {
        calls.push('Menu.new')
        return { setAsAppMenu: () => said('setAsAppMenu'), close: () => Promise.resolve() }
      },
    },
  }
})
const { followMenuBar } = await import('./native-menu-bar.svelte')
const { workspace } = await import('../../workspace/src/api')
const { shortcuts } = await import('../../shortcuts/src/api')
const { hiddenKinds } = await import('../../gates/src/api')
const { idle } = await import('../../../../test/effects/settle')
const context = () => ({
  view: undefined,
  onpalette: () => undefined,
  onhistory: () => undefined,
  app: { view: undefined, palette: () => undefined, fullscreen: () => undefined },
})
afterEach(() => {
  workspace.tabs = []
})
describe('the menu bar, as the tab in front changes between a page and a note', () => {
  test('is never built again: a switch tells its rows after the switch turn, and a row that goes refills its own menu', async () => {
    workspace.spaces = [{ id: 's', name: 'space', root: '/space' }]
    workspace.activeSpaceId = 's'
    workspace.openBlank('A note', '# A\n')
    const note = workspace.active?.id ?? ''
    const page = workspace.openPage('https://example.com') ?? ''
    workspace.activate(note)
    shortcuts.set('web.back', 'Mod-[')
    flushSync()
    followMenuBar(context)
    await vi.waitFor(() => expect(calls).toContain('setAsAppMenu'), { timeout: 10_000 })
    await idle(200)
    for (const [to, key] of [
      [page, 'Cmd+['],
      [note, 'null'],
    ] as const) {
      calls.length = 0
      workspace.activate(to)
      flushSync()
      await Promise.resolve()
      expect(calls).toEqual([])
      await vi.waitFor(() => expect(calls.some((one) => one.startsWith('accelerator '))).toBe(true))
      await idle(200)
      expect(calls.filter((one) => !/^(text|enabled|checked|accelerator) /.test(one))).toEqual([])
      expect(calls.filter((one) => one.startsWith('accelerator ')).map((one) => one.split(' ')[2])).toContain(key)
    }
    calls.length = 0
    hiddenKinds.hidden = ['note']
    flushSync()
    expect(calls).toEqual([])
    await vi.waitFor(() => expect(calls).toContain('append main/file'))
    await idle(200)
    expect(calls).not.toContain('Menu.new')
    expect(calls).not.toContain('setAsAppMenu')
    expect(new Set(calls.flatMap((one) => (/^(append|remove) /.test(one) ? [one] : [])))).toEqual(
      new Set(['remove main/file', 'append main/file']),
    )
    hiddenKinds.hidden = []
  })
})
