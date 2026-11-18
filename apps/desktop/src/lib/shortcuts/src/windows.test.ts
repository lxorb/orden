import { beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.mock('../../accounts/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../accounts/src/api')>()),
  api: { saveSettings: () => Promise.resolve({ settings: {} }) },
}))

type Heard = (event: { key: string | null }) => void
const windows: Heard[][] = []

async function aWindow() {
  const mine: Heard[] = []
  windows.push(mine)
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: Heard) => {
      if (type === 'storage') mine.push(listener)
    },
  })
  vi.resetModules()
  const [{ shortcuts }, { toolbar }] = await Promise.all([
    import('./shortcuts.svelte'),
    import('./toolbar.svelte'),
  ])
  shortcuts.restore()
  toolbar.restore()
  return { shortcuts, toolbar }
}

function told(key: string, except: number) {
  windows.forEach((one, at) => {
    if (at !== except) for (const listener of one) listener({ key })
  })
}

beforeEach(() => {
  windows.length = 0
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('document', {
    documentElement: { style: { setProperty: () => undefined }, dataset: {} },
    addEventListener: () => undefined,
  })
})

describe('shortcuts across two windows', () => {
  test('a key set in one is heard in the other, and its next change keeps it', async () => {
    const a = await aWindow()
    const b = await aWindow()
    a.shortcuts.set('format.bold', 'Mod-Alt-F9')
    told('orden:shortcuts', 0)
    expect(b.shortcuts.keyFor('format.bold')).toBe('Mod-Alt-F9')

    b.shortcuts.set('format.italic', 'Mod-Alt-F8')
    const kept = JSON.parse(localStorage.getItem('orden:shortcuts') ?? '{}') as object
    expect(kept).toMatchObject({ 'format.bold': 'Mod-Alt-F9', 'format.italic': 'Mod-Alt-F8' })
  })

  test('two changes before either window heard the other keep both', async () => {
    const a = await aWindow()
    const b = await aWindow()
    a.shortcuts.set('format.bold', 'Mod-Alt-F9')
    b.shortcuts.set('format.italic', 'Mod-Alt-F8')
    const kept = JSON.parse(localStorage.getItem('orden:shortcuts') ?? '{}') as object
    expect(kept).toMatchObject({ 'format.bold': 'Mod-Alt-F9', 'format.italic': 'Mod-Alt-F8' })
  })
})

describe('the bar across two windows', () => {
  test('a button put on in one is on the other', async () => {
    const a = await aWindow()
    const b = await aWindow()
    a.toolbar.add('paragraph.task-list')
    told('orden:toolbar', 0)
    expect(b.toolbar.ids.at(-1)).toBe('paragraph.task-list')

    b.toolbar.remove('format.bold')
    const kept = JSON.parse(localStorage.getItem('orden:toolbar') ?? '[]') as string[]
    expect(kept).toContain('paragraph.task-list')
  })
})

describe('storage that takes no more', () => {
  test('keeps each key set in this window rather than undoing the one before', async () => {
    const a = await aWindow()
    localStorage.setItem('orden:shortcuts', JSON.stringify({ 'format.code': 'Mod-Alt-F7' }))
    const setItem = localStorage.setItem.bind(localStorage)
    localStorage.setItem = (key, value) => {
      if (key === 'orden:shortcuts') throw new Error('full')
      setItem(key, value)
    }

    a.shortcuts.set('format.bold', 'Mod-Alt-F9')
    a.shortcuts.set('format.italic', 'Mod-Alt-F8')

    expect(a.shortcuts.keyFor('format.bold')).toBe('Mod-Alt-F9')
    expect(a.shortcuts.keyFor('format.italic')).toBe('Mod-Alt-F8')
  })
})
