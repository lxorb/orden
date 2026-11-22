import { invoke, isRecord, isString, takeKeyboard } from '../../platform/src/api'
import { DIVIDER, menu, type MenuEntry } from '../../ui-kit/src/api'
import { ASKS, grants, siteOf, type Ask } from './permissions.svelte'
import { pages, type Rect } from './pages.svelte'

type Listen = (name: string, tell: (event: { payload: unknown }) => void) => Promise<unknown>
interface MenuItemAsked {
  command: number
  label: string
  kind: 'command' | 'check' | 'radio' | 'separator' | 'submenu'
  enabled: boolean
  checked: boolean
  does: Does | null
  items: MenuItemAsked[]
}
export interface MenuAsked {
  tab: string
  id: number
  x: number
  y: number
  zoom: number
  link: string | null
  image: string | null
  keys: boolean
  items: MenuItemAsked[]
}
export interface DialogAsked {
  tab: string
  id: number
  kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload'
  message: string
  default: string | null
  origin: string | null
  reload: boolean
}
export interface PermissionAsked {
  tab: string
  id: number
  origin: string
  asks: Ask[]
}
export interface Choice {
  index: number
  label: string
  disabled: boolean
  group: string | null
}
export interface SelectAsked {
  tab: string
  id: number
  box: Rect
  zoom: number
  selected: number
  options: Choice[]
}
const SHOWN_HERE = ['menu', 'dialog', 'permission', 'select'] as const
const KINDS = ['command', 'check', 'radio', 'separator', 'submenu'] as const
const DOES = ['open-link', 'open-image'] as const
type Does = (typeof DOES)[number]
const DIALOGS = ['alert', 'confirm', 'prompt', 'beforeunload'] as const
const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const text = (value: unknown): string | null => (isString(value) ? value : null)
const filled = (value: unknown): string | null => (isString(value) && value !== '' ? value : null)
function readItem(said: unknown): MenuItemAsked | null {
  if (!isRecord(said)) return null
  const command = number(said.command)
  const kind = KINDS.find((one) => one === said.kind)
  if (command === null || !kind) return null
  return {
    command,
    label: text(said.label) ?? '',
    kind,
    enabled: said.enabled === true,
    checked: said.checked === true,
    does: DOES.find((one) => one === said.does) ?? null,
    items: Array.isArray(said.items) ? said.items.flatMap((one) => readItem(one) ?? []) : [],
  }
}
export function readMenu(said: unknown): MenuAsked | null {
  if (!isRecord(said) || !isString(said.tab)) return null
  const [id, x, y] = [number(said.id), number(said.x), number(said.y)]
  if (id === null || x === null || y === null || !Array.isArray(said.items)) return null
  return {
    tab: said.tab,
    id,
    x,
    y,
    zoom: number(said.zoom) ?? 1,
    link: filled(said.link),
    image: filled(said.image),
    keys: said.keys === true,
    items: said.items.flatMap((one) => readItem(one) ?? []),
  }
}
export function readDialog(said: unknown): DialogAsked | null {
  if (!isRecord(said) || !isString(said.tab)) return null
  const id = number(said.id)
  const kind = DIALOGS.find((one) => one === said.kind)
  if (id === null || !kind) return null
  return {
    tab: said.tab,
    id,
    kind,
    message: text(said.message) ?? '',
    default: text(said.default),
    origin: filled(said.origin),
    reload: said.reload === true,
  }
}
export function readPermission(said: unknown): PermissionAsked | null {
  if (!isRecord(said) || !isString(said.tab) || !isString(said.origin)) return null
  const id = number(said.id)
  if (id === null || !Array.isArray(said.asks)) return null
  const asks = said.asks.filter((one): one is Ask => ASKS.some((ask) => ask === one))
  return { tab: said.tab, id, origin: said.origin, asks }
}
export function readSelect(said: unknown): SelectAsked | null {
  if (!isRecord(said) || !isString(said.tab) || !Array.isArray(said.options)) return null
  const [id, x, y, width, height] = [said.id, said.x, said.y, said.width, said.height].map(number)
  if (id == null || x == null || y == null || width == null || height == null) return null
  const options = said.options.flatMap((one): Choice[] => {
    if (!isRecord(one) || number(one.index) === null) return []
    return [
      {
        index: number(one.index) ?? 0,
        label: text(one.label) ?? '',
        disabled: one.disabled === true,
        group: filled(one.group),
      },
    ]
  })
  return {
    tab: said.tab,
    id,
    box: { x, y, width, height },
    zoom: number(said.zoom) ?? 1,
    selected: number(said.selected) ?? -1,
    options,
  }
}
function paneOf(tab: string): Rect | null {
  const page = pages.peek(tab)
  return page?.sent && !page.sent.away && page.sent.visible ? page.sent.pane : null
}
export function onScreen(tab: string, at: Rect, zoom: number): Rect | null {
  const pane = paneOf(tab)
  if (!pane) return null
  return { x: pane.x + at.x * zoom, y: pane.y + at.y * zoom, width: at.width * zoom, height: at.height * zoom }
}
export interface OwnRows {
  open: (url: string) => void
}
export function menuRows(asked: MenuAsked, pick: (command: number) => void, own: OwnRows): MenuEntry[] {
  const rows = (items: readonly MenuItemAsked[]): MenuEntry[] =>
    items.map((one): MenuEntry => {
      if (one.kind === 'separator') return DIVIDER
      if (one.kind === 'submenu') {
        return {
          label: one.label,
          disabled: !one.enabled,
          run: () => undefined,
          more: () => Promise.resolve(rows(one.items)),
        }
      }
      const opens = one.does === 'open-link' ? asked.link : one.does === 'open-image' ? asked.image : null
      return {
        label: one.label,
        disabled: !one.enabled || (one.does !== null && opens === null),
        ...(one.kind === 'command' ? {} : { checked: one.checked }),
        run: () => (opens === null ? pick(one.command) : own.open(opens)),
      }
    })
  return rows(asked.items)
}
class Asked {
  dialogs = $state<DialogAsked[]>([])
  permissions = $state<PermissionAsked[]>([])
  select = $state<SelectAsked | null>(null)
  private menuOpen: { tab: string; id: number; which: number } | null = null
  private watching = false
  dialogOf(tab: string): DialogAsked | null {
    return this.dialogs.find((one) => one.tab === tab) ?? null
  }
  permissionOf(tab: string): PermissionAsked | null {
    return this.permissions.find((one) => one.tab === tab) ?? null
  }
  selectOf(tab: string): SelectAsked | null {
    return this.select?.tab === tab ? this.select : null
  }
  async showMenu(asked: MenuAsked): Promise<void> {
    const at = onScreen(asked.tab, { x: asked.x, y: asked.y, width: 0, height: 0 }, asked.zoom)
    if (!at) {
      void this.menuPicked(asked.tab, asked.id, null)
      return
    }
    this.closeMenu()
    const { workspace } = await import('../../workspace/src/api')
    const done = { tab: asked.tab, id: asked.id, which: -1 }
    const pick = (command: number | null) => {
      if (this.menuOpen !== done) return
      this.menuOpen = null
      void this.menuPicked(asked.tab, asked.id, command)
    }
    const rows = menuRows(asked, pick, {
      open: (url) => {
        pick(null)
        workspace.openPage(url, 'behind', asked.tab)
      },
    })
    this.menuOpen = done
    this.watchMenu()
    const shown = {
      type: 'contextmenu',
      clientX: at.x,
      clientY: at.y,
      buttons: 0,
      target: null,
      currentTarget: null,
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
    } as unknown as MouseEvent
    done.which = menu.show(shown, rows, { keys: asked.keys })
    void takeKeyboard()
    if (!done.which) pick(null)
  }
  private closeMenu() {
    const open = this.menuOpen
    if (!open) return
    this.menuOpen = null
    void this.menuPicked(open.tab, open.id, null)
  }
  private watchMenu() {
    if (this.watching) return
    this.watching = true
    $effect.root(() => {
      $effect(() => {
        const which = menu.which
        const mine = this.menuOpen
        if (mine && which !== mine.which) queueMicrotask(() => this.dropMenu(mine))
      })
    })
  }
  private dropMenu(mine: { tab: string; id: number; which: number }) {
    if (this.menuOpen !== mine) return
    if (mine.which < 0 || menu.which === mine.which) return
    this.menuOpen = null
    void this.menuPicked(mine.tab, mine.id, null)
  }
  private menuPicked(tab: string, id: number, command: number | null): Promise<unknown> {
    return invoke('web_menu_pick', { tab, id, command }).catch(() => undefined)
  }
  heardDialog(asked: DialogAsked) {
    void takeKeyboard()
    this.dialogs = [...this.dialogs.filter((one) => !(one.tab === asked.tab && one.id === asked.id)), asked]
  }
  answerDialog(asked: DialogAsked, ok: boolean, typed: string | null = null) {
    this.dialogGone(asked.tab, asked.id)
    const answer = asked.kind === 'alert' ? true : ok
    const text = asked.kind === 'prompt' && answer ? (typed ?? '') : null
    void invoke('web_dialog_answer', { tab: asked.tab, id: asked.id, ok: answer, text }).catch(() => undefined)
  }
  dialogGone(tab: string, id: number) {
    this.dialogs = this.dialogs.filter((one) => !(one.tab === tab && one.id === id))
  }
  heardPermission(asked: PermissionAsked) {
    const page = pages.peek(asked.tab)
    const privately = page?.inPrivate ?? false
    const site = siteOf(asked.origin)
    const said = asked.asks.map((one) => grants.said(site, one, privately))
    if (asked.asks.length === 0 || said.includes('block')) {
      this.answerPermission(asked, false, false)
      return
    }
    if (said.every((one) => one === 'allow')) {
      this.answerPermission(asked, true, false)
      return
    }
    this.permissions = [...this.permissions.filter((one) => !(one.tab === asked.tab && one.id === asked.id)), asked]
    void takeKeyboard()
  }
  answerPermission(asked: PermissionAsked, allow: boolean, remember = true) {
    this.permissionGone(asked.tab, asked.id)
    if (remember) {
      const privately = pages.peek(asked.tab)?.inPrivate ?? false
      for (const one of asked.asks) grants.remember(siteOf(asked.origin), one, allow ? 'allow' : 'block', privately)
    }
    void invoke('web_permission_answer', { tab: asked.tab, id: asked.id, allow }).catch(() => undefined)
  }
  permissionGone(tab: string, id: number) {
    this.permissions = this.permissions.filter((one) => !(one.tab === tab && one.id === id))
  }
  heardSelect(asked: SelectAsked) {
    void takeKeyboard()
    const was = this.select
    if (was) void this.selectPicked(was, null)
    this.select = asked
  }
  pickSelect(asked: SelectAsked, index: number | null) {
    if (this.select !== asked) return
    this.select = null
    void this.selectPicked(asked, index)
  }
  private selectPicked(asked: SelectAsked, index: number | null): Promise<unknown> {
    return invoke('web_select_pick', { tab: asked.tab, id: asked.id, index }).catch(() => undefined)
  }
  forget(tab: string) {
    for (const one of this.dialogs.filter((each) => each.tab === tab)) this.answerDialog(one, false)
    for (const one of this.permissions.filter((each) => each.tab === tab)) this.answerPermission(one, false, false)
    const select = this.selectOf(tab)
    if (select) this.pickSelect(select, null)
  }
}
export const asked = new Asked()
export async function hearAsks(listen: Listen): Promise<void> {
  const gone = (said: unknown): { tab: string; id: number } | null =>
    isRecord(said) && isString(said.tab) && number(said.id) !== null
      ? { tab: said.tab, id: number(said.id) ?? 0 }
      : null
  await listen('orden://web-menu', (event) => {
    const said = readMenu(event.payload)
    if (said) void asked.showMenu(said)
  })
  await listen('orden://web-dialog', (event) => {
    const said = readDialog(event.payload)
    if (said) asked.heardDialog(said)
  })
  await listen('orden://web-dialog-gone', (event) => {
    const said = gone(event.payload)
    if (said) asked.dialogGone(said.tab, said.id)
  })
  await listen('orden://web-permission', (event) => {
    const said = readPermission(event.payload)
    if (said) asked.heardPermission(said)
  })
  await listen('orden://web-permission-gone', (event) => {
    const said = gone(event.payload)
    if (said) asked.permissionGone(said.tab, said.id)
  })
  await listen('orden://web-select', (event) => {
    const said = readSelect(event.payload)
    if (said) asked.heardSelect(said)
  })
  await invoke('web_page_ui', { kinds: SHOWN_HERE }).catch(() => undefined)
}
