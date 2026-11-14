import type { EditorView } from '@orden/editor'
import type {
  CheckMenuItem,
  Menu,
  MenuItem as TauriMenuItem,
  PredefinedMenuItem,
  Submenu,
} from '@tauri-apps/api/menu'
import { account } from './accounts/src/api'
import { fullscreen } from './fullscreen.svelte'
import { hiddenKinds } from './settings.svelte'
import type { MenuItem } from './menu-item'
import { modes } from './modes.svelte'
import {
  type Change,
  changesBetween,
  describeMenuBar,
  documentWindows,
  flatten,
  type KeyboardAt,
  keyRuns,
  keystrokeOf,
  leftFullscreen,
  letPass,
  type MenuBarSources,
  type MenuBarWords,
  type NativeEntry,
  type NativeItem,
  type SeenKey,
  type StandIn,
} from './native-menu'
import { shortcuts } from './shortcuts.svelte'
import { type AppContext, BY_ID, runEntry } from './shortcuts/registry'
import { appMenuRows } from './surfaces.svelte'
import { takeKeyboard } from './take-keyboard'
import { currentWindow, invoke } from './tauri'
import { afterQuiet } from './timing'
import { viewport } from './viewport.svelte'
import { workspace } from './workspace.svelte'

export interface MenuBarContext {
  view?: EditorView | undefined
  onpalette(): void
  onhistory(): void
  app: AppContext
}

const NAME = 'Orden'

const SETTLE = 60

type Native = TauriMenuItem | CheckMenuItem | PredefinedMenuItem | Submenu

interface Built {
  made: Native[]
  byId: Map<string, Native>
  windows: Submenu | null
  help: Submenu | null
}

async function othersOpen(): Promise<boolean> {
  const { getAllWindows } = await import('@tauri-apps/api/window')
  return documentWindows((await getAllWindows()).map((one) => one.label)) > 1
}

async function close(objects: { close(): Promise<void> }[]): Promise<void> {
  await Promise.all(objects.map((one) => one.close().catch(() => undefined)))
}

function words(): MenuBarWords {
  return {
    app: NAME,
    about: `About ${NAME}`,
    services: 'Services',
    hide: `Hide ${NAME}`,
    hideOthers: 'Hide others',
    showAll: 'Show all',
    quit: `Quit ${NAME}`,
    window: 'Window',
    minimize: 'Minimize',
    zoom: 'Zoom',
    bringAllToFront: 'Bring all to front',
    find: 'Find',
  }
}

function signature(context: MenuBarContext): unknown[] {
  const active = workspace.active

  return [
    context.view,
    'File',
    shortcuts.overrides,
    workspace.activeTabId,
    active?.kind,
    active?.path,
    active?.reading,
    workspace.closed.any,
    workspace.panel,
    workspace.panes.count,
    modes.readOnly,
    active?.source,
    modes.typewriter,
    modes.focus,
    modes.alwaysOnTop,
    modes.highlightTone,
    fullscreen.on,
    account.user,
    viewport.touch,
    hiddenKinds.shown.join(),
  ]
}

function entryRow(id: string, context: MenuBarContext, row: Partial<MenuItem> = {}): MenuItem {
  return {
    label: BY_ID.get(id)?.label() ?? id,
    command: id,
    run: () => void runEntry(id, context.app),
    ...row,
  }
}

function fileRows(context: MenuBarContext): MenuBarSources['file'] {
  const open = !!workspace.active

  return {
    opening: [
      ...(hiddenKinds.offers('note') ? [entryRow('app.new', context)] : []),
      entryRow('app.new-kind', context, { label: 'New tab' }),
      entryRow('app.new-window', context),
      ...(hiddenKinds.offers('private') ? [entryRow('app.new-private', context)] : []),
    ],
    closing: [
      entryRow('app.close', context, { disabled: !open }),
      entryRow('app.reopen', context, { disabled: !workspace.closed.any }),
      entryRow('app.close-window', context),
    ],
  }
}

const RELOADING = new Set(['web.reload', 'web.fresh', 'web.back', 'web.forward'])

function reloadRows(context: MenuBarContext): MenuItem[] {
  const web = workspace.active?.kind === 'web'
  const step = (how: 'reload' | 'fresh') => () => {
    const tab = workspace.active
    if (tab?.kind === 'web')
      void import('./web-tab/pages.svelte').then(({ pages }) => pages.step(tab.id, how))
  }
  return [
    entryRow('web.reload', context, { disabled: !web, run: step('reload') }),
    entryRow('web.fresh', context, { disabled: !web, run: step('fresh') }),
    ...(web
      ? [
          entryRow('web.back', context, { run: () => workspace.goBack() }),
          entryRow('web.forward', context, { run: () => workspace.goForward() }),
        ]
      : []),
  ]
}

class MenuBar {
  private context: MenuBarContext | null = null
  private label = ''
  private menu: Menu | null = null
  private windows: Submenu | null = null
  private told: Submenu | null = null
  private help: Submenu | null = null
  private made: Native[] = []
  private byId = new Map<string, Native>()
  private shown: NativeEntry[] = []
  private live = new Map<string, NativeItem>()
  private runs = new Map<string, () => void>()
  private front = false
  private passing: Promise<void> = Promise.resolve()
  private seen: SeenKey | null = null

  private readonly soon = afterQuiet(() => this.pass(), SETTLE)

  async follow(context: () => MenuBarContext): Promise<void> {
    const frame = await currentWindow()
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const own = getCurrentWindow()
    this.label = own.label
    this.front = await own.isFocused()

    window.addEventListener(
      'keydown',
      (event) => {
        if (event.isTrusted) this.seen = { event, at: performance.now() }
      },
      true,
    )

    await own.onFocusChanged(({ payload }) => {
      this.front = payload
      if (payload) this.pass(true)
    })

    this.followFullscreen(frame)

    $effect.root(() => {
      $effect(() => {
        const now = context()
        signature(now)
        this.context = now
        this.soon()
      })
    })
  }

  private pass(raise = false): void {
    this.passing = this.passing.then(() => this.catchUp(raise)).catch(() => undefined)
  }

  private async catchUp(raise: boolean): Promise<void> {
    const context = this.context
    if (!context) return

    const appMenu = await appMenuRows()
    const described = describeMenuBar({
      groups: appMenu(context),
      file: fileRows(context),
      settings: entryRow('app.settings', context),
      windowRows: [entryRow('app.next-note', context), entryRow('app.previous-note', context)],
      helpRows: [entryRow('app.keys', context)],
      viewRows: reloadRows(context),
      keyFor: (command) => shortcuts.keyFor(command),
      isWindowCommand: (command) => BY_ID.get(command)?.scope === 'app' || RELOADING.has(command),
      words: words(),
    })
    const entries = this.owned(described.entries)

    this.runs = new Map([...described.runs].map(([id, run]) => [this.idOf(id), run]))
    this.live = new Map(
      flatten(entries).flatMap((one) => (one.kind === 'item' ? [[one.id, one]] : [])),
    )

    const fresh = raise && this.told !== null && (await othersOpen())
    const changes = this.menu && !fresh ? changesBetween(this.shown, entries) : null
    if (changes) await this.patch(changes)
    else await this.build(entries)

    this.shown = entries
    if (this.front && (raise || !changes)) await this.raise()
  }

  private async raise(): Promise<void> {
    await this.menu?.setAsAppMenu()
    await this.help?.setAsHelpMenuForNSApp()
    if (this.windows && this.windows !== this.told) {
      await this.windows.setAsWindowsMenuForNSApp()
      this.told = this.windows
    }
  }

  private idOf(id: string): string {
    return `${this.label}/${id}`
  }

  private owned(entries: NativeEntry[]): NativeEntry[] {
    return entries.map((one): NativeEntry => {
      const id = this.idOf(one.id)
      return one.kind === 'submenu' ? { ...one, id, items: this.owned(one.items) } : { ...one, id }
    })
  }

  private async patch(changes: Change[]): Promise<void> {
    await Promise.all(
      changes.map(async (change) => {
        const native = this.byId.get(change.id)
        if (!native) return

        if (change.text !== undefined) await native.setText(change.text)
        if ('setEnabled' in native && change.enabled !== undefined) {
          await native.setEnabled(change.enabled)
        }
        if ('setChecked' in native && change.checked !== undefined) {
          await native.setChecked(change.checked)
        }
        if ('setAccelerator' in native && change.accelerator !== undefined) {
          await native.setAccelerator(change.accelerator)
        }
      }),
    )
  }

  private async build(entries: NativeEntry[]): Promise<void> {
    const { Menu } = await import('@tauri-apps/api/menu')
    const built: Built = { made: [], byId: new Map(), windows: null, help: null }

    try {
      const items = await Promise.all(entries.map((one) => this.make(one, built)))
      const menu = await Menu.new({ items })
      const before = [...this.made, ...(this.menu ? [this.menu] : [])]

      this.menu = menu
      this.made = built.made
      this.byId = built.byId
      this.windows = built.windows
      this.help = built.help
      await close(before)
    } catch (error) {
      await close(built.made)
      throw error
    }
  }

  private async make(entry: NativeEntry, built: Built): Promise<Native> {
    const api = await import('@tauri-apps/api/menu')
    let made: Native

    if (entry.kind === 'rule') {
      made = await api.PredefinedMenuItem.new({ item: 'Separator' })
    } else if (entry.kind === 'system') {
      const item = entry.item === 'About' ? { About: null } : entry.item
      made = await api.PredefinedMenuItem.new({ item, text: entry.text })
    } else if (entry.kind === 'submenu') {
      const items = await Promise.all(entry.items.map((one) => this.make(one, built)))
      const submenu = await api.Submenu.new({
        id: entry.id,
        text: entry.text,
        enabled: entry.enabled,
        items,
      })
      if (entry.role === 'window') built.windows = submenu
      if (entry.role === 'help') built.help = submenu
      made = submenu
    } else {
      const options = {
        id: entry.id,
        text: entry.text,
        enabled: entry.enabled,
        ...(entry.accelerator ? { accelerator: entry.accelerator } : {}),
        action: (id: string) => this.dispatch(id),
      }
      made =
        entry.checked === undefined
          ? await api.MenuItem.new(options)
          : await api.CheckMenuItem.new({ ...options, checked: entry.checked })
    }

    built.made.push(made)
    built.byId.set(entry.id, made)
    return made
  }

  private dispatch(id: string): void {
    const entry = this.live.get(id)
    const run = this.runs.get(id)
    if (!entry || !run) return

    if (entry.key && letPass(entry.key, this.seen, performance.now())) return

    const away = !document.hasFocus()
    if (entry.standIn) {
      this.standIn(entry.standIn, entry.key, away)
      return
    }

    const at: KeyboardAt = away ? 'away' : this.context?.view?.hasFocus ? 'note' : 'page'
    if (entry.key && !keyRuns(entry.anywhere, at)) return
    if (away) void takeKeyboard()

    run()
  }

  private standIn(action: StandIn, key: string | null, away: boolean): void {
    const keystroke = key ? keystrokeOf(key) : null
    if (!away && keystroke) {
      const event = new KeyboardEvent('keydown', { ...keystroke, bubbles: true, cancelable: true })
      ;(document.activeElement ?? document.body).dispatchEvent(event)
      if (event.defaultPrevented) return
    }

    void invoke('hand_to_keyboard', { action }).catch(() => undefined)
  }

  private followFullscreen(frame: Awaited<ReturnType<typeof currentWindow>>): void {
    let was = false
    void frame.isFullscreen().then((now) => (was = now))
    void frame.onResized(() => {
      void frame.isFullscreen().then((now) => {
        if (leftFullscreen(was, now, fullscreen.on)) void fullscreen.leave()
        was = now
      })
    })
  }
}

export function followMenuBar(context: () => MenuBarContext): void {
  void new MenuBar().follow(context)
}
