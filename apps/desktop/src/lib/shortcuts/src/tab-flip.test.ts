import { beforeEach, describe, expect, test, vi } from 'vitest'
import { sameCombination } from '../../ui-kit/src/keys'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
const ran = vi.hoisted(() => [] as string[])
vi.mock('@orden/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@orden/contracts')>()),
  runCommand: (id: string) => {
    ran.push(id)
    return Promise.resolve(true)
  },
}))
const { hiddenKinds, KINDS_KEY, EXPERIMENTAL_WORD, EXPLORER_WORD } = await import('../../gates/src/api')
const { workspace } = await import('../../workspace/src/api')
const { BY_ID, SHORTCUTS, runEntry } = await import('./registry')
const { shortcuts } = await import('./shortcuts.svelte')
const PLATFORMS = ['mac', 'win', 'linux'] as const
const idle = { palette: () => undefined, fullscreen: () => undefined }
function explorer(on: boolean) {
  localStorage.setItem(KINDS_KEY, JSON.stringify(on ? [EXPERIMENTAL_WORD, EXPLORER_WORD] : [EXPERIMENTAL_WORD]))
  hiddenKinds.restore()
}
function inFront(kind: string | null) {
  vi.spyOn(workspace, 'active', 'get').mockReturnValue(
    (kind ? { id: 'one', kind } : null) as unknown as typeof workspace.active,
  )
}
const onPlatform = (platform: string) => {
  const one = Object.create(shortcuts) as typeof shortcuts
  Object.defineProperty(one, 'platform', { value: platform })
  return one
}
beforeEach(() => {
  ran.length = 0
  localStorage.clear()
  vi.restoreAllMocks()
})
describe('the key that turns a terminal into the file explorer and back', () => {
  test('is an app row of the desktop on Ctrl+Alt+U, Cmd+Option+U on a Mac', () => {
    const entry = BY_ID.get('tab.flip')
    expect(entry?.scope).toBe('app')
    expect(entry?.category).toBe('view')
    expect(entry?.desktop).toBe(true)
    for (const platform of PLATFORMS) expect(onPlatform(platform).keyFor('tab.flip'), platform).toBe('Mod-Alt-u')
    expect(shortcuts.tooltip('Terminal', 'tab.flip')).toBe('Terminal (Ctrl+Alt+U)')
  })
  test('is shown only while the file explorer is turned on', () => {
    explorer(false)
    expect(BY_ID.get('tab.flip')?.shown?.()).toBe(false)
    explorer(true)
    expect(BY_ID.get('tab.flip')?.shown?.()).toBe(true)
  })
  test('turns the tab in front by its kind, and leaves any other tab alone', () => {
    explorer(true)
    inFront('terminal')
    expect(runEntry('tab.flip', idle)).toBe(true)
    inFront('explorer')
    runEntry('tab.flip', idle)
    inFront('note')
    runEntry('tab.flip', idle)
    inFront(null)
    runEntry('tab.flip', idle)
    expect(ran).toEqual(['terminal.turn', 'explorer.turn'])
  })
  test('runs nothing while the file explorer is off', () => {
    explorer(false)
    inFront('terminal')
    expect(runEntry('tab.flip', idle)).toBe(false)
    expect(ran).toEqual([])
  })
  test('shares its key with no other row and no system key, on any system', () => {
    for (const platform of PLATFORMS) {
      const one = onPlatform(platform)
      const key = one.keyFor('tab.flip') ?? ''
      const others = SHORTCUTS.filter((row) => {
        const held = row.id === 'tab.flip' ? null : one.keyFor(row.id)
        return !!held && sameCombination(held, key, platform)
      }).map((row) => row.id)
      expect(others, platform).toEqual([])
      expect(one.warning(key), platform).toBeNull()
    }
  })
})
