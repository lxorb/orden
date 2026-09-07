/** Nib runs both as a Tauri app and as a page in a browser. Everything
 *  platform-specific funnels through here so the interface never branches. */

// Guarded so this module can be imported where there is no window: tests today,
// and server-side rendering once the web app is prerendered.
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** The browser build answers the same commands from its own storage, so every
 *  call site reads the same on both. */
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop) {
    const { webInvoke } = await import('./web/commands')
    return webInvoke<T>(command, args)
  }

  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

/** Stands in for the Tauri window. In a browser a page cannot minimise itself,
 *  so those become no-ops and the buttons that would call them are hidden. */
interface WindowLike {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  isMaximized(): Promise<boolean>
  setFullscreen(on: boolean): Promise<void>
  isFullscreen(): Promise<boolean>
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
  if (!isDesktop) return browserWindow

  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

/** A webview cannot load a bare filesystem path; Tauri hands out a URL for one.
 *  In the browser the path is a key into storage, resolved by the image layer. */
export function assetUrl(path: string): string {
  if (!isDesktop) return path

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

/** A link to somewhere outside the app: the system browser on a desktop, a
 *  new tab in a browser. */
export async function openExternal(url: string): Promise<void> {
  if (!isDesktop) {
    window.open(url, '_blank', 'noopener')
    return
  }

  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
}
