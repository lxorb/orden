import { render } from 'svelte/server'
import { expect, test, vi } from 'vitest'

const asked: { command: string; args: Record<string, unknown> | undefined }[] = []
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  invoke: (command: string, args?: Record<string, unknown>) => {
    asked.push({ command, args })
    return Promise.resolve(undefined)
  },
}))
const { extensions, NOT_WORKING, pinnedOf, readExtension } = await import('./extensions.svelte')
const WebExtensions = (await import('./WebExtensions.svelte')).default
const ExtensionRows = (await import('./ExtensionRows.svelte')).default
const OLD = 'It uses an old format this browser no longer runs'
function one(id: string, name: string, more: Record<string, unknown> = {}) {
  const said = readExtension({ id, version: '1.0', name, action: true, popup: 'popup.html', ...more })
  if (!said) throw new Error('no extension')
  return said
}
test('an extension Chromium cannot run is read with its reason, and one it runs has none', () => {
  expect(one('a', 'uBlock Origin', { cannotRun: OLD }).cannotRun).toBe(OLD)
  expect(one('b', 'Proton Pass').cannotRun).toBeNull()
  expect(one('c', 'Dark Reader', { cannotRun: '' }).cannotRun).toBeNull()
})
test('it is not working, says why, offers only Remove, and has no button in the bar', () => {
  extensions.list = [one('a', 'uBlock Origin', { cannotRun: OLD, pending: true }), one('b', 'Proton Pass')]
  const bubble = render(WebExtensions, { props: { right: 0, onpress: () => undefined, onclose: () => undefined } }).body
  const settings = render(ExtensionRows).body
  for (const html of [bubble, settings]) {
    expect(html).toContain(NOT_WORKING)
    expect(html).toContain(OLD)
    expect(html.match(/>\s*Remove\s*</g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(html).not.toContain('Restart Orden to finish installing uBlock Origin')
  }
  expect((bubble.match(/aria-label="(Pin|Unpin)"/g) ?? []).length).toBe(1)
  expect(settings).not.toContain('Turn uBlock Origin on or off')
  expect(pinnedOf(extensions.list).map((each) => each.id)).toEqual(['b'])
  extensions.list = []
})
test('its Remove takes it out, and its popup never opens', async () => {
  extensions.list = [one('a', 'uBlock Origin', { cannotRun: OLD })]
  extensions.open('a', 't1', null)
  expect(extensions.popped).toBeNull()
  asked.length = 0
  await extensions.remove('a')
  expect(asked.map((each) => each.command)).toEqual(['extensions_remove'])
  expect(asked[0]?.args).toEqual({ id: 'a' })
  expect(extensions.list).toEqual([])
})
