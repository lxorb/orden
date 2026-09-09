/** Nib runs three ways: as the desktop app, as the phone app, and as a page in a
 *  browser. Everything platform-specific funnels through here so the interface
 *  never branches. */

import { platform } from '@tauri-apps/plugin-os'

/** The two platforms that are a phone app rather than a desktop one. */
const PHONES = new Set<string>(['android', 'ios'])

// Guarded so this module can be imported where there is no window: tests today,
// and server-side rendering once the web app is prerendered.
/** Inside the Tauri app, whichever platform: the crate answers `invoke`, so
 *  there are real files behind the notes and the page is nobody's tab. */
export const isNative = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** The phone app. `platform()` reads what the os plugin left in the page before
 *  the first script ran, so this is known without waiting for anything. */
export const isMobile = isNative && PHONES.has(platform())

/** The desktop app, which is the only build with a window of its own to
 *  minimise, a second window to present from, a file dialog, a shell around it
 *  and an installer to update itself with. */
export const isDesktop = isNative && !isMobile

/** The browser build answers the same commands from its own storage, so every
 *  call site reads the same on all three. */
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isNative) {
    const { webInvoke } = await import('./web/commands')
    return webInvoke<T>(command, args)
  }

  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

/** Stands in for the Tauri window. In a browser a page cannot minimise itself,
 *  so those become no-ops and the buttons that would call them are hidden. The
 *  phone app has a real window but no title bar, so it never calls them either. */
interface WindowLike {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  isMaximized(): Promise<boolean>
  setFullscreen(on: boolean): Promise<void>
  isFullscreen(): Promise<boolean>
  /** Keeps the window over every other application's. A page in a browser has no
   *  window of its own to raise, so there it does nothing. */
  setAlwaysOnTop(on: boolean): Promise<void>
  close(): Promise<void>
  destroy(): Promise<void>
  setTitle(title: string): Promise<void>
  onCloseRequested(handler: (event: { preventDefault(): void }) => void): Promise<() => void>
  /** Every time the window changes size, whoever changed it: a corner dragged, a
   *  maximised window pulled off the top of the screen, Win and an arrow key, a
   *  double click on the bar. What the title bar's own button reads its state
   *  from, since it is only one of the ways the state changes. */
  onResized(handler: () => void): Promise<() => void>
}

// Each answers a promise because the desktop's does; none of them waits on
// anything, so none of them is written as `async`.
const browserWindow: WindowLike = {
  minimize: () => Promise.resolve(),
  toggleMaximize: () => Promise.resolve(),
  isMaximized: () => Promise.resolve(false),
  setFullscreen: async (on: boolean) => {
    if (on) await document.documentElement.requestFullscreen().catch(() => undefined)
    else await document.exitFullscreen().catch(() => undefined)
  },
  isFullscreen: () => Promise.resolve(document.fullscreenElement !== null),
  setAlwaysOnTop: () => Promise.resolve(),
  close: () => Promise.resolve(),
  destroy: () => Promise.resolve(),
  setTitle: (title: string) => {
    document.title = title
    return Promise.resolve()
  },
  // A page cannot ask its own question on the way out: the browser owns that
  // dialog. The handler is still run so unsaved work can be written first.
  onCloseRequested: (handler) => {
    const listener = (event: BeforeUnloadEvent) => {
      // Written inside the handler's own callback, so it is read back through a
      // holder the compiler can see changing.
      const asked = { prevent: false }
      handler({
        preventDefault: () => {
          asked.prevent = true
        },
      })
      if (asked.prevent) event.preventDefault()
    }

    window.addEventListener('beforeunload', listener)
    return Promise.resolve(() => window.removeEventListener('beforeunload', listener))
  },
  // A page is resized by the browser's own window, which it hears about the
  // ordinary way.
  onResized: (handler) => {
    window.addEventListener('resize', handler)
    return Promise.resolve(() => window.removeEventListener('resize', handler))
  },
}

export async function currentWindow(): Promise<WindowLike> {
  if (!isNative) return browserWindow

  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

/** A webview cannot load a bare filesystem path; Tauri hands out a URL for one.
 *  In the browser the path is a key into storage, resolved by the image layer. */
export function assetUrl(path: string): string {
  if (!isNative) return path

  const internals = (
    window as unknown as { __TAURI_INTERNALS__?: { convertFileSrc?: (p: string) => string } }
  ).__TAURI_INTERNALS__

  return internals?.convertFileSrc?.(path) ?? path
}

export function folderOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, '')
}

export function joinPath(dir: string, relative: string): string {
  const separator = dir.includes('\\') ? '\\' : '/'
  return `${dir}${separator}${relative.split('/').join(separator)}`
}

/** Whether an address is one the app hands to the system.
 *
 *  A link in a note is words the note wrote, and a note can arrive from a shared
 *  space, a room or somebody's export. `file:`, `smb:` and the rest would ask the
 *  system to open something on this machine, and `javascript:` would run in the
 *  page - so the list is the four the opener plugin's own scope grants, said here
 *  as well because the browser build has no such scope to fall back on. See
 *  `opener:allow-default-urls` in src-tauri/capabilities.
 *
 *  A path with no scheme at all is one of ours and never reaches here; every
 *  caller has already decided the address points outside the app. */
const OPENABLE = /^(?:https?|mailto|tel):/i

export function isOpenable(url: string): boolean {
  // A protocol-relative address is http's, and that is what a browser makes of it.
  return url.startsWith('//') || OPENABLE.test(url)
}

/** A link to somewhere outside the app: the system browser on a desktop, the
 *  browser app on a phone, a new tab in a browser. An address in no scheme the
 *  app hands over does nothing, which is what a note asking for one deserves. */
export async function openExternal(url: string): Promise<void> {
  if (!isOpenable(url)) return

  if (!isNative) {
    window.open(url, '_blank', 'noopener')
    return
  }

  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
}
