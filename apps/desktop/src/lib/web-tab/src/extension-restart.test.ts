import { render } from 'svelte/server'
import { expect, test, vi } from 'vitest'

const asked: string[] = []
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  invoke: (command: string) => {
    asked.push(command)
    return Promise.resolve(undefined)
  },
}))
const { extensions, readExtension } = await import('./extensions.svelte')
const WebExtensions = (await import('./WebExtensions.svelte')).default
const ExtensionRows = (await import('./ExtensionRows.svelte')).default
function one(id: string, name: string, more: Record<string, unknown> = {}) {
  const said = readExtension({ id, version: '1.0', name, ...more })
  if (!said) throw new Error('no extension')
  return said
}
const RESTART = /Restart Orden to (finish installing|turn off) ([^<]+?)\s*</g
function asks(html: string): string[] {
  return [...html.matchAll(RESTART)].map((match) => `${match[1] ?? ''}: ${match[2] ?? ''}`)
}
test('an extension that starts only after a restart offers the restart, and says why when Chromium did', () => {
  extensions.list = [
    one('a', 'Proton Pass', { pending: true, problem: 'Manifest key "commands" needs a newer engine' }),
    one('b', 'uBlock Origin Lite'),
    one('c', 'Dark Reader', { pending: true, enabled: false }),
  ]
  const bubble = render(WebExtensions, { props: { right: 0, onpress: () => undefined, onclose: () => undefined } }).body
  const settings = render(ExtensionRows).body
  for (const html of [bubble, settings]) {
    expect(asks(html)).toEqual(['finish installing: Proton Pass', 'turn off: Dark Reader'])
    expect(html).toContain('Manifest key "commands" needs a newer engine')
    expect(html).toContain('Turns off when Orden next opens')
  }
  extensions.list = []
})
test('and the restart is the app’s own', async () => {
  asked.length = 0
  await extensions.restart()
  expect(asked).toEqual(['extensions_restart'])
})
