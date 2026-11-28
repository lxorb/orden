export const PROTOCOL = 1
export const SCHEMES = ['tauri', 'ipc', 'asset'] as const
export const TO_CORE = '-to-core'
export const TO_SHELL = '-to-shell'
export type Pair = [string, string]
interface WindowOptions {
  title?: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  x?: number
  y?: number
  center?: boolean
  resizable?: boolean
  maximizable?: boolean
  minimizable?: boolean
  closable?: boolean
  fullscreen?: boolean
  focused?: boolean
  focusable?: boolean
  maximized?: boolean
  show?: boolean
  transparent?: boolean
  frame?: boolean
  alwaysOnTop?: boolean
  skipTaskbar?: boolean
  hasShadow?: boolean
  backgroundColor?: string
}
export interface Script {
  script: string
  mainFrameOnly: boolean
}
interface Extent {
  width: number
  height: number
  physical: boolean
}
interface Place {
  x: number
  y: number
  physical: boolean
}
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}
export interface Display {
  name: string | null
  bounds: Bounds
  workArea: Bounds
  scale: number
}
export interface WindowValues {
  scaleFactor: undefined
  innerBounds: undefined
  outerBounds: undefined
  isFullScreen: undefined
  isMinimized: undefined
  isMaximized: undefined
  isFocused: undefined
  isDecorated: undefined
  isResizable: undefined
  isMaximizable: undefined
  isMinimizable: undefined
  isClosable: undefined
  isVisible: undefined
  isEnabled: undefined
  isAlwaysOnTop: undefined
  getTitle: undefined
  center: undefined
  flashFrame: boolean
  setResizable: boolean
  setMaximizable: boolean
  setMinimizable: boolean
  setClosable: boolean
  setTitle: string
  maximize: undefined
  unmaximize: undefined
  minimize: undefined
  restore: undefined
  show: undefined
  hide: undefined
  close: undefined
  destroy: undefined
  setHasShadow: boolean
  setAlwaysOnTop: boolean
  setVisibleOnAllWorkspaces: boolean
  setContentProtection: boolean
  setSize: Extent
  setMinSize: Extent | null
  setMaxSize: Extent | null
  setPosition: Place
  setFullScreen: boolean
  setSimpleFullScreen: boolean
  focus: undefined
  setFocusable: boolean
  setSkipTaskbar: boolean
  setIgnoreMouseEvents: boolean
  setEnabled: boolean
}
export interface WebviewValues {
  openDevTools: undefined
  closeDevTools: undefined
  isDevToolsOpened: undefined
  setZoomFactor: number
  getUrl: undefined
  bounds: undefined
  loadUrl: string
  reload: undefined
  goBack: undefined
  canGoBack: undefined
  goForward: undefined
  canGoForward: undefined
  print: undefined
  focus: undefined
  clearData: undefined
}
export interface Call {
  method: string
  value?: unknown
}
export type Screens =
  | { which: 'all' }
  | { which: 'primary' }
  | { which: 'point'; x: number; y: number }
  | { which: 'window'; window: number }
export type ToShell =
  | { op: 'hello'; protocol: number; identifier: string; schemes: string[]; transport: 'post-message' | 'scheme' }
  | { op: 'window-create'; window: number; label: string; options: WindowOptions }
  | {
      op: 'webview-create'
      window: number
      webview: number
      label: string
      url: string
      scripts: Script[]
      devtools: boolean | null
      user_agent: string | null
    }
  | { op: 'window-call'; window: number; id: number | null; call: Call }
  | { op: 'webview-call'; webview: number; id: number | null; call: Call }
  | { op: 'eval'; webview: number; id: number | null; script: string }
  | { op: 'respond'; request: number; status: number; headers: Pair[] }
  | { op: 'refuse'; request: number }
  | { op: 'screen'; id: number; screens: Screens }
  | { op: 'cursor'; id: number }
  | { op: 'dark'; id: number }
  | { op: 'version'; id: number }
  | { op: 'theme'; theme: string | null }
  | { op: 'exit'; code: number }
export type WindowChange =
  | { kind: 'close' }
  | { kind: 'closed' }
  | { kind: 'focus' }
  | { kind: 'blur' }
  | { kind: 'resize'; width: number; height: number }
  | { kind: 'move'; x: number; y: number }
export type FromShell =
  | { op: 'welcome'; protocol: number }
  | { op: 'reply'; id: number; value: unknown }
  | { op: 'request'; request: number; webview: number | null; url: string; method: string; headers: Pair[] }
  | { op: 'post'; webview: number | null; url: string }
  | { op: 'page'; webview: number; url: string; event: 'started' | 'finished' }
  | { op: 'window'; window: number; event: WindowChange }
  | { op: 'opened'; urls: string[] }
export interface Frame {
  head: ToShell
  body: Buffer
}
const SIZES = 8
export function framed(head: FromShell, body?: Uint8Array): Buffer {
  const said = Buffer.from(JSON.stringify(head))
  const sizes = Buffer.alloc(SIZES)
  sizes.writeUInt32LE(said.length, 0)
  sizes.writeUInt32LE(body?.length ?? 0, 4)
  return body?.length ? Buffer.concat([sizes, said, body]) : Buffer.concat([sizes, said])
}
export class Frames {
  #chunks: Buffer[] = []
  #held = 0
  #wanted = SIZES
  take(chunk: Buffer): Frame[] {
    this.#chunks.push(chunk)
    this.#held += chunk.length
    if (this.#held < this.#wanted) return []
    let kept = this.#chunks.length === 1 ? chunk : Buffer.concat(this.#chunks)
    const whole: Frame[] = []
    this.#wanted = SIZES
    while (kept.length >= SIZES) {
      const head = kept.readUInt32LE(0)
      const end = SIZES + head + kept.readUInt32LE(4)
      if (kept.length < end) {
        this.#wanted = end
        break
      }
      whole.push({
        head: JSON.parse(kept.subarray(SIZES, SIZES + head).toString()) as ToShell,
        body: kept.subarray(SIZES + head, end),
      })
      kept = kept.subarray(end)
    }
    this.#chunks = kept.length ? [kept] : []
    this.#held = kept.length
    return whole
  }
}
