import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

interface Capability {
  platforms: string[]
  permissions: string[]
  webviews?: string[]
  windows?: string[]
}

const capabilities = JSON.parse(read('../src-tauri/capabilities/default.json')) as Capability
const mobile = JSON.parse(read('../src-tauri/capabilities/mobile.json')) as Capability

const NEEDS: Record<string, string> = {
  minimize: 'core:window:allow-minimize',
  toggleMaximize: 'core:window:allow-toggle-maximize',
  isMaximized: 'core:window:allow-is-maximized',
  setAlwaysOnTop: 'core:window:allow-set-always-on-top',
  outerPosition: 'core:window:allow-outer-position',
  outerSize: 'core:window:allow-outer-size',
  scaleFactor: 'core:window:allow-scale-factor',
  close: 'core:window:allow-close',
  destroy: 'core:window:allow-destroy',
  setTitle: 'core:window:allow-set-title',
}

const EVENTS = new Set(['onCloseRequested', 'onResized'])

const CRATE: Record<string, string> = {
  setFullscreen: 'window_fullscreen',
  isFullscreen: 'window_is_fullscreen',
}
const FULL_SCREEN = ['core:window:allow-set-fullscreen', 'core:window:allow-is-fullscreen']

const TAKING = ['core:window:allow-set-focus', 'core:webview:allow-set-webview-focus']

function sources(): [string, string][] {
  const root = fileURLToPath(new URL('../src/', import.meta.url))
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts'))
    .map((name) => [name, readFileSync(join(root, name), 'utf8')])
}

function windowMethods(): string[] {
  const source = read('../src/lib/platform/src/tauri.ts')
  const [, block] = /interface WindowLike \{([\s\S]*?)\n\}/.exec(source) ?? []
  if (block === undefined) throw new Error('WindowLike interface not found in tauri.ts')

  return [...block.matchAll(/^\s{2}(\w+)\(/gm)].map(([, name = '']) => name)
}

const APPEARANCE = {
  file: '../src/lib/theme/src/theme.svelte.ts',
  calls: ['getCurrentWindow().setTheme('],
  permission: 'core:window:allow-set-theme',
}

describe('window permissions', () => {
  test('the interface was actually found', () => {
    expect(windowMethods().length).toBeGreaterThan(5)
  })

  test('every window command the app can call is granted', () => {
    const missing = windowMethods()
      .filter((name) => !EVENTS.has(name) && !(name in CRATE))
      .filter((name) => !capabilities.permissions.includes(NEEDS[name] ?? `unmapped:${name}`))

    expect(missing, `ungranted or unmapped: ${missing.join(', ')}`).toEqual([])
  })

  test('no page builds a window: the crate builds them, in the interface’s profile', () => {
    expect(sources().filter(([, text]) => text.includes('new WebviewWindow('))).toEqual([])
    expect(capabilities.permissions).not.toContain('core:webview:allow-create-webview-window')
  })

  test('a Mac’s window is told the scheme, and is granted that', () => {
    const source = read(APPEARANCE.file)

    expect(APPEARANCE.calls.filter((call) => !source.includes(call))).toEqual([])
    expect(capabilities.permissions).toContain(APPEARANCE.permission)
  })

  test('nothing in the page takes the keyboard or the front past the crate', () => {
    expect(sources().length).toBeGreaterThan(100)

    const calling = sources()
      .filter(([, text]) => text.includes('.setFocus('))
      .map(([name]) => name)

    expect(calling).toEqual([])
    expect(capabilities.permissions.filter((one) => TAKING.includes(one))).toEqual([])
  })

  test('full screen is the crate’s, and the window plugin’s is not granted', () => {
    const tauri = read('../src/lib/platform/src/tauri.ts')
    const lib = read('../src-tauri/src/lib.rs')
    for (const command of Object.values(CRATE)) {
      expect(tauri).toContain(`('${command}'`)
      expect(lib).toContain(`full_screen::${command}`)
    }
    for (const build of [capabilities, mobile]) {
      expect(build.permissions.filter((one) => FULL_SCREEN.includes(one))).toEqual([])
    }
  })

  test('nothing is granted that the app never calls', () => {
    const used = new Set([...Object.values(NEEDS), APPEARANCE.permission])
    const stale = capabilities.permissions
      .filter((one) => one.startsWith('core:window:') || one.startsWith('core:webview:allow-'))
      .filter((one) => one !== 'core:window:allow-start-dragging')
      .filter((one) => !used.has(one))

    expect(stale).toEqual([])
  })
})

function desktopOnlyPlugins(): string[] {
  const cargo = read('../src-tauri/Cargo.toml')
  const [, block] =
    /\[target\.'cfg\(any\(target_os = "windows".*\n([\s\S]*?)(?:\n\[|$)/.exec(cargo) ?? []
  if (block === undefined) throw new Error('no desktop-only dependencies in Cargo.toml')

  return [...block.matchAll(/^tauri-plugin-([a-z-]+)/gm)].map(([, name = '']) => name)
}

describe('writing an export', () => {
  test('goes through the app’s own commands, so no build grants the fs plugin', () => {
    for (const [build, granted] of [
      ['desktop', capabilities.permissions],
      ['phone', mobile.permissions],
    ] as const) {
      expect(
        granted.filter((one) => one.startsWith('fs:')),
        `${build} grants the fs plugin`,
      ).toEqual([])
    }
  })

  test('writes bytes through a command the crate registers and the frontend calls', () => {
    expect(read('../src-tauri/src/lib.rs')).toContain('notes::write_bytes')
    expect(read('../src-tauri/src/notes.rs')).toContain('pub fn write_bytes')
    expect(read('../src/lib/export/save.ts')).toContain('writeBytes(')
    expect(read('../src/lib/workspace/write-file.ts')).toContain("invoke('write_bytes'")
  })

  test('and the write is whole, which is what the plugin could not give it', () => {
    expect(read('../src-tauri/src/notes.rs')).toContain('write_in_place(target, bytes)')
    const paths = read('../src-tauri/src/paths.rs')
    expect(paths).toContain('let copy = staged(target, bytes, false)?;')
    expect(paths).toContain('fs::rename(&copy, target)')
  })

  test('asks the desktop where to save, which needs the save dialog', () => {
    expect(read('../src/lib/export/save.ts')).toContain("import('@tauri-apps/plugin-dialog')")
    expect(capabilities.permissions).toContain('dialog:allow-save')
  })

  test('shows the finished file in the file manager, which the opener covers', () => {
    expect(read('../src/lib/export/save.ts')).toContain("import('../reveal')")
    expect(read('../src/lib/reveal.ts')).toContain('revealItemInDir')
    expect(capabilities.permissions).toContain('opener:default')
  })

  test('a phone writes into its own documents folder, since it has no dialog', () => {
    expect(read('../src/lib/export/save.ts')).toContain('spaces_root')
    expect(mobile.permissions.filter((one) => one.startsWith('dialog:'))).toEqual([])
  })
})

describe('looking for a new version', () => {
  test('goes through the app’s own command, which needs no permission of its own', () => {
    expect(read('../src-tauri/src/lib.rs')).toContain('updates::check_update')
    expect(read('../src/lib/updater.ts')).toContain("invoke<unknown>('check_update'")
    expect(capabilities.permissions).not.toContain('updater:allow-check')
  })

  test('downloads and installs through the plugin, which is granted both', () => {
    expect(read('../src/lib/updater.ts')).toContain("import('@tauri-apps/plugin-updater')")
    expect(capabilities.permissions).toContain('updater:allow-download')
    expect(capabilities.permissions).toContain('updater:allow-install')
  })

  test('reads one endpoint per channel, the releases being the configured one', () => {
    const config = JSON.parse(read('../src-tauri/tauri.conf.json')) as {
      plugins: { updater: { endpoints: string[] } }
    }
    const { endpoints } = config.plugins.updater

    expect(endpoints).toHaveLength(1)
    expect(endpoints[0]).not.toContain('/edge/')
    expect(read('../src-tauri/src/updates.rs')).toContain('/edge/')
  })
})

describe('webview labels', () => {
  test('the desktop capability names webviews rather than windows', () => {
    expect(capabilities.webviews).toBeDefined()
    expect(capabilities.windows).toBeUndefined()
  })

  function labelShape(): string {
    const source = read('../src-tauri/src/launch.rs')
    const [, block] = /fn free_label\(([\s\S]*?)\n\}/.exec(source) ?? []
    const [, format] = /format!\("([^"]+)"/.exec(block ?? '') ?? []
    if (format === undefined) throw new Error('no window label format in free_label')

    return format
  }

  const matches = (pattern: string, label: string) =>
    new RegExp(`^${pattern.replace(/\[0-9\]/g, '\\d').replace(/\*/g, '.*')}$`).test(label)

  test('the label the crate hands out is covered', () => {
    expect(labelShape()).toBe('orden-{}')

    for (const label of ['main', 'orden-2', 'orden-3', 'orden-17', 'orden-1000']) {
      expect(
        (capabilities.webviews ?? []).some((pattern) => matches(pattern, label)),
        `${label} is granted nothing`,
      ).toBe(true)
    }
  })

  test('the phone has one window and names it', () => {
    expect(mobile.windows).toEqual(['main'])
  })
})

describe('phone permissions', () => {
  test('the two files divide the platforms between them', () => {
    expect([...capabilities.platforms].sort()).toEqual(['linux', 'macOS', 'windows'])
    expect([...mobile.platforms].sort()).toEqual(['android', 'iOS'])

    const both = mobile.platforms.filter((one) => capabilities.platforms.includes(one))
    expect(both, 'a platform in both files gets both sets of permissions').toEqual([])
  })

  test('the phone grants nothing for a plugin it does not have', () => {
    const plugins = desktopOnlyPlugins()
    expect(plugins).toContain('updater')

    const wrong = mobile.permissions.filter((one) =>
      plugins.some((plugin) => one.startsWith(`${plugin}:`)),
    )

    expect(wrong, `granted to a build without the plugin: ${wrong.join(', ')}`).toEqual([])
  })

  test('a link tapped in a note can still leave the app', () => {
    expect(read('../src/lib/platform/src/tauri.ts')).toContain('await openUrl(url)')
    expect(mobile.permissions).toContain('opener:allow-open-url')
    expect(mobile.permissions).toContain('opener:allow-default-urls')
  })

  test('the phone has no window commands, because it has no title bar', () => {
    const chrome = mobile.permissions.filter(
      (one) => one.startsWith('core:window:allow-') || one.startsWith('core:webview:allow-'),
    )

    expect(chrome).toEqual([])
  })
})
