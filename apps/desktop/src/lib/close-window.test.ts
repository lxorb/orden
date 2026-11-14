import { afterEach, describe, expect, test, vi } from 'vitest'

const closed = vi.fn(() => Promise.resolve())
let os = 'macos'

vi.mock('./platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform/src/api')>()),
  isDesktop: true,
  isNative: true,
  platform: () => os,
  closeWindow: closed,
}))

const { SHORTCUTS } = await import('./shortcuts/src/api')
const { workspace } = await import('./workspace.svelte')
await import('./tab-strip/src/api')
const { appCommands } = await import('./commands/src/api')

const context = { onpalette: () => undefined, onhistory: () => undefined }

async function press(id: string) {
  const entry = SHORTCUTS.find((one) => one.id === id)
  if (!entry?.run) throw new Error(`${id} runs nothing`)
  entry.run(context as never)
  await new Promise((done) => setTimeout(done))
}

function showing(tab: string | null) {
  vi.spyOn(workspace, 'activeTabId', 'get').mockReturnValue(tab)
  return vi.spyOn(workspace, 'closeActive').mockResolvedValue(undefined)
}

afterEach(() => {
  vi.restoreAllMocks()
  closed.mockClear()
  os = 'macos'
})

describe('Cmd+W', () => {
  test('closes the note that is open', async () => {
    const closing = showing('one')
    await press('app.close')

    expect(closing).toHaveBeenCalledOnce()
    expect(closed).not.toHaveBeenCalled()
  })

  test('closes the window on a Mac once nothing is left in it', async () => {
    const closing = showing(null)
    await press('app.close')

    expect(closed).toHaveBeenCalledOnce()
    expect(closing).not.toHaveBeenCalled()
  })

  test('but not while the tabs are only put down', async () => {
    showing(null)
    const was = workspace.tabs
    workspace.tabs = [{} as never]
    await press('app.close')
    workspace.tabs = was

    expect(closed).not.toHaveBeenCalled()
  })

  test('and nowhere else, where one more press than notes would end the app', async () => {
    os = 'windows'
    showing(null)
    await press('app.close')

    expect(closed).not.toHaveBeenCalled()
  })
})

describe('Close window', () => {
  test('is Shift and the same key, and closes the window with a note in it', async () => {
    showing('one')
    await press('app.close-window')

    expect(SHORTCUTS.find((one) => one.id === 'app.close-window')?.key).toBe('Mod-Shift-w')
    expect(closed).toHaveBeenCalledOnce()
  })

  test('and a command of the palette, beside New window', () => {
    const ids = appCommands().map((one) => one.id)
    const row = appCommands().find((one) => one.id === 'close-window')

    expect(ids.indexOf('close-window')).toBe(ids.indexOf('new-window') + 1)
    row?.run()
    expect(closed).toHaveBeenCalledOnce()
  })
})
