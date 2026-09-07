import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** Tauri denies anything the capability file does not grant, and a denied call
 *  rejects a promise nobody is awaiting - so the button simply does nothing.
 *  That is how `destroy` went missing and the close button stopped working.
 *
 *  `WindowLike` in `tauri.ts` is the whole set of window commands the app can
 *  reach, so it is the list to check against. */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const capabilities = JSON.parse(read('../src-tauri/capabilities/default.json')) as {
  permissions: string[]
}

/** Method name to the permission Tauri wants for it. Events are not commands
 *  and need nothing, so they are left out. */
const NEEDS: Record<string, string> = {
  minimize: 'core:window:allow-minimize',
  toggleMaximize: 'core:window:allow-toggle-maximize',
  isMaximized: 'core:window:allow-is-maximized',
  setFullscreen: 'core:window:allow-set-fullscreen',
  isFullscreen: 'core:window:allow-is-fullscreen',
  close: 'core:window:allow-close',
  destroy: 'core:window:allow-destroy',
  setTitle: 'core:window:allow-set-title',
}

const EVENTS = new Set(['onCloseRequested', 'onResized'])

/** The window commands presenting calls, which do not go through `WindowLike`:
 *  the presenter's window is opened with the Tauri API directly, because it is
 *  a second window rather than this one. Each is the call as it is written in
 *  slides/presenter.ts, so a permission cannot outlive the code that needed it.
 *  See docs/slides.md. */
const PRESENTING: Record<string, string> = {
  'new WebviewWindow(': 'core:webview:allow-create-webview-window',
  'availableMonitors()': 'core:window:allow-available-monitors',
  'currentMonitor()': 'core:window:allow-current-monitor',
  'setFocus()': 'core:window:allow-set-focus',
}

/** The method names declared on the `WindowLike` interface. */
function windowMethods(): string[] {
  const source = read('../src/lib/tauri.ts')
  const [, block] = /interface WindowLike \{([\s\S]*?)\n\}/.exec(source) ?? []
  if (block === undefined) throw new Error('WindowLike interface not found in tauri.ts')

  return [...block.matchAll(/^\s{2}(\w+)\(/gm)].map(([, name = '']) => name)
}

describe('window permissions', () => {
  test('the interface was actually found', () => {
    // Guards the test itself: a rename that empties this would pass silently.
    expect(windowMethods().length).toBeGreaterThan(5)
  })

  test('every window command the app can call is granted', () => {
    const missing = windowMethods()
      .filter((name) => !EVENTS.has(name))
      .filter((name) => !capabilities.permissions.includes(NEEDS[name] ?? `unmapped:${name}`))

    expect(missing, `ungranted or unmapped: ${missing.join(', ')}`).toEqual([])
  })

  test('every call presenting makes is granted, and it makes each of them', () => {
    const source = read('../src/lib/slides/presenter.ts')

    const missing = Object.entries(PRESENTING).filter(
      ([call, permission]) =>
        !source.includes(call) || !capabilities.permissions.includes(permission),
    )

    expect(missing.map(([call]) => call)).toEqual([])
  })

  test('nothing is granted that the app never calls', () => {
    const used = new Set([...Object.values(NEEDS), ...Object.values(PRESENTING)])
    const stale = capabilities.permissions
      .filter((one) => one.startsWith('core:window:') || one.startsWith('core:webview:allow-'))
      // Dragging comes from `data-tauri-drag-region`, not a method call.
      .filter((one) => one !== 'core:window:allow-start-dragging')
      .filter((one) => !used.has(one))

    expect(stale).toEqual([])
  })
})
