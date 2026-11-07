import { assetRoute, assetStorePath } from './web/asset-route'

const PHONES = new Set<string>(['android', 'ios'])

export const isNative = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export function platform(): string {
  if (typeof window === 'undefined') return ''

  const os = (window as { __TAURI_OS_PLUGIN_INTERNALS__?: { platform?: string } })
    .__TAURI_OS_PLUGIN_INTERNALS__
  const found = os?.platform ?? ''

  if (!found && isNative) {
    console.error(
      'nib cannot tell which operating system it is on: window.__TAURI_OS_PLUGIN_INTERNALS__.platform is not there, and the os plugin registered in src-tauri/src/lib.rs is what writes it.',
    )
  }

  return found
}

export const isMobile = isNative && PHONES.has(platform())

export const isDesktop = isNative && !isMobile

if (isNative) void import('./native')

export const asking = new Map<number, { command: string; at: number }>()
let calls = 0

export const internal: {
  routed: ((command: string, args?: Record<string, unknown>) => boolean) | null
  file: ((path: string) => string | null) | null
  flush: (() => Promise<void>) | null
  answered: ((command: string, args?: Record<string, unknown>) => Promise<unknown> | null) | null
} = { routed: null, file: null, flush: null, answered: null }

const SPACE_COMMANDS = new Set(['list_spaces', 'create_space', 'rename_space', 'delete_space'])

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const answer = internal.answered?.(command, args)
  if (answer) return answer as Promise<T>
  if (!isNative) {
    const { webInvoke } = await import('./web/commands')
    return webInvoke<T>(command, args)
  }
  if (internal.routed?.(command, args) || (isDesktop && SPACE_COMMANDS.has(command))) {
    const { internalInvoke } = await import('./internal/route')
    return internalInvoke<T>(command, args)
  }

  const call = ++calls
  asking.set(call, { command, at: performance.now() })
  try {
    const { invoke } = await import('./native')
    return await invoke<T>(command, args)
  } finally {
    asking.delete(call)
  }
}

interface WindowLike {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  isMaximized(): Promise<boolean>
  setFullscreen(on: boolean): Promise<void>
  isFullscreen(): Promise<boolean>
  setAlwaysOnTop(on: boolean): Promise<void>
  outerPosition(): Promise<{ x: number; y: number }>
  outerSize(): Promise<{ width: number; height: number }>
  scaleFactor(): Promise<number>
  close(): Promise<void>
  destroy(): Promise<void>
  setTitle(title: string): Promise<void>
  onCloseRequested(handler: (event: { preventDefault(): void }) => void): Promise<() => void>
  onResized(handler: () => void): Promise<() => void>
}

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
  outerPosition: () => Promise.resolve({ x: 0, y: 0 }),
  outerSize: () => Promise.resolve({ width: window.innerWidth, height: window.innerHeight }),
  scaleFactor: () => Promise.resolve(window.devicePixelRatio),
  close: () => Promise.resolve(),
  destroy: () => Promise.resolve(),
  setTitle: (title: string) => {
    document.title = title
    return Promise.resolve()
  },
  onCloseRequested: (handler) => {
    const listener = (event: BeforeUnloadEvent) => {
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
  onResized: (handler) => {
    window.addEventListener('resize', handler)
    return Promise.resolve(() => window.removeEventListener('resize', handler))
  },
}

export async function currentWindow(): Promise<WindowLike> {
  if (!isNative) return browserWindow

  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return Object.assign(Object.create(getCurrentWindow()) as WindowLike, {
    setFullscreen: (on: boolean) => invoke<undefined>('window_fullscreen', { on }),
    isFullscreen: () => invoke<boolean>('window_is_fullscreen'),
  })
}

export async function closeWindow(): Promise<void> {
  if (isDesktop) await (await currentWindow()).close()
}

export function assetUrl(path: string): string {
  if (!isNative) return assetRoute(path)

  const internals = (
    window as unknown as { __TAURI_INTERNALS__?: { convertFileSrc?: (p: string) => string } }
  ).__TAURI_INTERNALS__

  const file = internal.file?.(path) ?? path
  return internals?.convertFileSrc?.(file) ?? file
}

const ASSET_PROTOCOL = /^(?:asset:\/\/localhost\/|https?:\/\/asset\.localhost\/)/i

export function assetPath(url: string): string | null {
  if (!isNative) return assetStorePath(url)
  if (!ASSET_PROTOCOL.test(url)) return null

  try {
    return decodeURIComponent(url.replace(ASSET_PROTOCOL, '').split(/[?#]/)[0] ?? '') || null
  } catch {
    return null
  }
}

export function joinPath(dir: string, relative: string): string {
  const separator = dir.includes('\\') ? '\\' : '/'
  return `${dir}${separator}${relative.split('/').join(separator)}`
}

const OPENABLE = /^(?:https?|mailto|tel):/i

export function isOpenable(url: string): boolean {
  return url.startsWith('//') || OPENABLE.test(url)
}

export async function openExternal(url: string): Promise<void> {
  if (!isOpenable(url)) return

  if (!isNative) {
    window.open(url, '_blank', 'noopener')
    return
  }

  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
}

export function whenScreenGivenBack(given: () => void): () => void {
  if (typeof document === 'undefined' || !document.fullscreenElement) return () => undefined

  const heard = () => {
    if (document.fullscreenElement) return
    stop()
    given()
  }
  const stop = () => document.removeEventListener('fullscreenchange', heard)
  document.addEventListener('fullscreenchange', heard)
  return stop
}
