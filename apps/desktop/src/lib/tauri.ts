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
}

const browserWindow: WindowLike = {
  minimize: async () => undefined,
  toggleMaximize: async () => undefined,
  isMaximized: async () => false,
  setFullscreen: async (on: boolean) => {
    if (on) await document.documentElement.requestFullscreen().catch(() => undefined)
    else await document.exitFullscreen().catch(() => undefined)
  },
  isFullscreen: async () => !!document.fullscreenElement,
  close: async () => undefined,
  destroy: async () => undefined,
  setTitle: async (title: string) => {
    document.title = title
  },
  // A page cannot ask its own question on the way out: the browser owns that
  // dialog. The handler is still run so unsaved work can be written first.
  onCloseRequested: async (handler) => {
    const listener = (event: BeforeUnloadEvent) => {
      let prevented = false
      handler({ preventDefault: () => (prevented = true) })
      if (prevented) event.preventDefault()
    }

    window.addEventListener('beforeunload', listener)
    return () => window.removeEventListener('beforeunload', listener)
  },
}

export async function currentWindow(): Promise<WindowLike> {
  if (!isDesktop) return browserWindow

  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow() as unknown as WindowLike
}

/** A webview cannot load a bare filesystem path; Tauri hands out a URL for one.
 *  In the browser the path is a key into storage, resolved by the image layer. */
export function assetUrl(path: string): string {
  if (!isDesktop) return path

  const internals = (window as unknown as { __TAURI_INTERNALS__?: { convertFileSrc?: (p: string) => string } })
    .__TAURI_INTERNALS__

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
