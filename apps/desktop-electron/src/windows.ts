import { BrowserWindow, screen } from 'electron'
import type { BrowserWindowConstructorOptions, Rectangle, WebContents } from 'electron'
import { join } from 'node:path'
import type {
  Bounds,
  Call,
  Display,
  FromShell,
  Screens,
  Script,
  ToShell,
  WebviewValues,
  WindowChange,
  WindowValues,
} from './wire'

export type Send = (head: FromShell, body?: Uint8Array) => void
type Said<Op extends ToShell['op']> = Extract<ToShell, { op: Op }>
type Handlers<Values, Target> = { [Method in keyof Values]: (target: Target, value: Values[Method]) => unknown }
type Table<Target> = Record<string, (target: Target, value: unknown) => unknown>
interface Held {
  win: BrowserWindow
  frame: boolean
  leaving: boolean
  maximize: boolean
}
interface Page {
  window: number
  contents: WebContents
  id: number
  scripts: Script[]
}
interface Shown extends Page {
  win: BrowserWindow
}
const NONE: [number, number] = [0, 0]
function scaleOf(win: BrowserWindow): number {
  return screen.getDisplayMatching(win.getBounds()).scaleFactor
}
function scaled(rect: Rectangle, scale: number): Bounds {
  return {
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale),
  }
}
function physical(win: BrowserWindow, rect: Rectangle): Bounds {
  return scaled(rect, scaleOf(win))
}
function logical(win: BrowserWindow, said: { physical: boolean }, first: number, second: number): [number, number] {
  const scale = said.physical ? scaleOf(win) : 1
  return [Math.round(first / scale), Math.round(second / scale)]
}
function given<Options extends object>(all: { [Key in keyof Options]: Options[Key] | undefined }): Options {
  return Object.fromEntries(Object.entries(all).filter(([, value]) => value !== undefined)) as Options
}
function displayed(one: Electron.Display): Display {
  return {
    name: one.label || String(one.id),
    bounds: scaled(one.bounds, one.scaleFactor),
    workArea: scaled(one.workArea, one.scaleFactor),
    scale: one.scaleFactor,
  }
}
function sameSite(one: string, other: string): boolean {
  try {
    const [first, second] = [new URL(one), new URL(other)]
    return first.protocol === second.protocol && first.host === second.host
  } catch {
    return false
  }
}
export const windowCalls: Handlers<WindowValues, Held> = {
  scaleFactor: ({ win }) => scaleOf(win),
  innerBounds: ({ win }) => physical(win, win.getContentBounds()),
  outerBounds: ({ win }) => physical(win, win.getBounds()),
  isFullScreen: ({ win }) => win.isFullScreen(),
  isMinimized: ({ win }) => win.isMinimized(),
  isMaximized: ({ win }) => win.isMaximized(),
  isFocused: ({ win }) => win.isFocused(),
  isDecorated: ({ frame }) => frame,
  isResizable: ({ win }) => win.isResizable(),
  isMaximizable: ({ win }) => win.isMaximizable(),
  isMinimizable: ({ win }) => win.isMinimizable(),
  isClosable: ({ win }) => win.isClosable(),
  isVisible: ({ win }) => win.isVisible(),
  isEnabled: ({ win }) => win.isEnabled(),
  isAlwaysOnTop: ({ win }) => win.isAlwaysOnTop(),
  getTitle: ({ win }) => win.getTitle(),
  center: ({ win }) => win.center(),
  flashFrame: ({ win }, on) => win.flashFrame(on),
  setResizable: ({ win }, on) => win.setResizable(on),
  setMaximizable: ({ win }, on) => win.setMaximizable(on),
  setMinimizable: ({ win }, on) => win.setMinimizable(on),
  setClosable: ({ win }, on) => win.setClosable(on),
  setTitle: ({ win }, title) => win.setTitle(title),
  maximize: ({ win }) => win.maximize(),
  unmaximize: ({ win }) => win.unmaximize(),
  minimize: ({ win }) => win.minimize(),
  restore: ({ win }) => win.restore(),
  show: (held) => {
    held.win.show()
    if (held.maximize) held.win.maximize()
    held.maximize = false
  },
  hide: ({ win }) => win.hide(),
  close: ({ win }) => win.close(),
  destroy: (held) => {
    held.leaving = true
    held.win.destroy()
  },
  setHasShadow: ({ win }, on) => win.setHasShadow(on),
  setAlwaysOnTop: ({ win }, on) => win.setAlwaysOnTop(on),
  setVisibleOnAllWorkspaces: ({ win }, on) => win.setVisibleOnAllWorkspaces(on),
  setContentProtection: ({ win }, on) => win.setContentProtection(on),
  setSize: ({ win }, said) => win.setContentSize(...logical(win, said, said.width, said.height)),
  setMinSize: ({ win }, said) => win.setMinimumSize(...(said ? logical(win, said, said.width, said.height) : NONE)),
  setMaxSize: ({ win }, said) => win.setMaximumSize(...(said ? logical(win, said, said.width, said.height) : NONE)),
  setPosition: ({ win }, said) => win.setPosition(...logical(win, said, said.x, said.y)),
  setFullScreen: ({ win }, on) => win.setFullScreen(on),
  setSimpleFullScreen: ({ win }, on) => win.setSimpleFullScreen(on),
  focus: ({ win }) => win.focus(),
  setFocusable: ({ win }, on) => win.setFocusable(on),
  setSkipTaskbar: ({ win }, on) => win.setSkipTaskbar(on),
  setIgnoreMouseEvents: ({ win }, on) => win.setIgnoreMouseEvents(on),
  setEnabled: ({ win }, on) => win.setEnabled(on),
}
export const webviewCalls: Handlers<WebviewValues, Shown> = {
  openDevTools: ({ contents }) => contents.openDevTools({ mode: 'detach' }),
  closeDevTools: ({ contents }) => contents.closeDevTools(),
  isDevToolsOpened: ({ contents }) => contents.isDevToolsOpened(),
  setZoomFactor: ({ contents }, factor) => contents.setZoomFactor(factor),
  getUrl: ({ contents }) => contents.getURL(),
  bounds: ({ win }) => ({ ...physical(win, win.getContentBounds()), x: 0, y: 0 }),
  loadUrl: ({ contents }, url) => contents.loadURL(url),
  reload: ({ contents }) => contents.reload(),
  goBack: ({ contents }) => contents.navigationHistory.goBack(),
  canGoBack: ({ contents }) => contents.navigationHistory.canGoBack(),
  goForward: ({ contents }) => contents.navigationHistory.goForward(),
  canGoForward: ({ contents }) => contents.navigationHistory.canGoForward(),
  print: ({ contents }) => contents.print(),
  focus: ({ contents }) => contents.focus(),
  clearData: ({ contents }) => contents.session.clearStorageData(),
}
function called<Target>(table: Table<Target>, target: Target, call: Call): unknown {
  return Object.hasOwn(table, call.method) ? table[call.method]?.(target, call.value) : null
}
export class Windows {
  alone = false
  readonly #windows = new Map<number, Held>()
  readonly #pages = new Map<number, Page>()
  readonly #byContents = new Map<number, number>()
  readonly #send: Send
  constructor(send: Send) {
    this.#send = send
  }
  pageOf(contents: number): number | undefined {
    return this.#byContents.get(contents)
  }
  scriptsOf(contents: number): Script[] {
    const page = this.#byContents.get(contents)
    return (page === undefined ? undefined : this.#pages.get(page)?.scripts) ?? []
  }
  create(said: Said<'window-create'>): void {
    const asked = said.options
    const win = new BrowserWindow(
      given<BrowserWindowConstructorOptions>({
        title: asked.title,
        width: asked.width,
        height: asked.height,
        minWidth: asked.minWidth,
        minHeight: asked.minHeight,
        maxWidth: asked.maxWidth,
        maxHeight: asked.maxHeight,
        x: asked.x,
        y: asked.y,
        center: asked.center,
        resizable: asked.resizable,
        maximizable: asked.maximizable,
        minimizable: asked.minimizable,
        closable: asked.closable,
        fullscreen: asked.fullscreen === true ? true : undefined,
        focusable: asked.focusable,
        transparent: asked.transparent,
        frame: asked.frame,
        alwaysOnTop: asked.alwaysOnTop,
        skipTaskbar: asked.skipTaskbar,
        hasShadow: asked.hasShadow,
        backgroundColor: asked.backgroundColor,
        useContentSize: true,
        show: false,
        icon: join(__dirname, 'icon.png'),
        webPreferences: {
          preload: join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        },
      }),
    )
    const held: Held = { win, frame: asked.frame !== false, leaving: false, maximize: false }
    this.#windows.set(said.window, held)
    const tell = (event: WindowChange): void => {
      this.#send({ op: 'window', window: said.window, event })
    }
    win.on('close', (event) => {
      if (held.leaving || this.alone) return
      event.preventDefault()
      tell({ kind: 'close' })
    })
    win.on('closed', () => {
      this.#windows.delete(said.window)
      for (const [webview, page] of this.#pages) {
        if (page.window !== said.window) continue
        this.#pages.delete(webview)
        this.#byContents.delete(page.id)
      }
      tell({ kind: 'closed' })
    })
    win.on('focus', () => {
      tell({ kind: 'focus' })
    })
    win.on('blur', () => {
      tell({ kind: 'blur' })
    })
    win.on('resize', () => {
      const { width, height } = physical(win, win.getContentBounds())
      tell({ kind: 'resize', width, height })
    })
    win.on('move', () => {
      const { x, y } = physical(win, win.getBounds())
      tell({ kind: 'move', x, y })
    })
    if (asked.show === false) {
      held.maximize = asked.maximized === true
      return
    }
    if (asked.maximized) win.maximize()
    if (asked.focused === false) win.showInactive()
    else win.show()
  }
  attach(said: Said<'webview-create'>): void {
    const held = this.#windows.get(said.window)
    if (!held) return
    const contents = held.win.webContents
    this.#pages.set(said.webview, { window: said.window, contents, id: contents.id, scripts: said.scripts })
    this.#byContents.set(contents.id, said.webview)
    if (said.user_agent) contents.setUserAgent(said.user_agent)
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event) => {
      if (!sameSite(event.url, said.url)) event.preventDefault()
    })
    contents.on('did-start-navigation', (event) => {
      if (event.isMainFrame && !event.isSameDocument)
        this.#send({ op: 'page', webview: said.webview, url: event.url, event: 'started' })
    })
    contents.on('did-finish-load', () => {
      this.#send({ op: 'page', webview: said.webview, url: contents.getURL(), event: 'finished' })
    })
    void contents.loadURL(said.url).catch((error: unknown) => {
      console.error('the page did not load', said.url, error)
    })
  }
  windowCall(said: Said<'window-call'>): unknown {
    const held = this.#windows.get(said.window)
    return held ? called(windowCalls as Table<Held>, held, said.call) : null
  }
  webviewCall(said: Said<'webview-call'>): unknown {
    const shown = this.#shown(said.webview)
    return shown ? called(webviewCalls as Table<Shown>, shown, said.call) : null
  }
  evaluate(said: Said<'eval'>): Promise<unknown> | null {
    const shown = this.#shown(said.webview)
    if (!shown) return null
    return shown.contents.mainFrame.executeJavaScript(said.script)
  }
  screens(asked: Screens): Display[] {
    if (asked.which === 'all') return screen.getAllDisplays().map(displayed)
    if (asked.which === 'point')
      return [displayed(screen.getDisplayNearestPoint({ x: Math.round(asked.x), y: Math.round(asked.y) }))]
    const held = asked.which === 'window' ? this.#windows.get(asked.window) : undefined
    return [displayed(held ? screen.getDisplayMatching(held.win.getBounds()) : screen.getPrimaryDisplay())]
  }
  front(): void {
    const first = this.#windows.values().next().value
    if (!first) return
    if (first.win.isMinimized()) first.win.restore()
    first.win.show()
    first.win.focus()
  }
  destroyAll(): void {
    for (const held of [...this.#windows.values()]) {
      held.leaving = true
      held.win.destroy()
    }
  }
  #shown(webview: number): Shown | null {
    const page = this.#pages.get(webview)
    const held = page && this.#windows.get(page.window)
    return page && held && !page.contents.isDestroyed() ? { ...page, win: held.win } : null
  }
}
export function cursor(): { x: number; y: number } {
  const at = screen.getCursorScreenPoint()
  const scale = screen.getDisplayNearestPoint(at).scaleFactor
  return { x: at.x * scale, y: at.y * scale }
}
