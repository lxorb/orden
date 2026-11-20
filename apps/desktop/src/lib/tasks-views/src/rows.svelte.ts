import { shortcuts } from '../../shortcuts/src/api'
import { dayAfter, PRIORITIES, PRIORITY_NAMES, type Todo, type TodoPatch } from '../../tasks-model/src/api'
import { Selection } from '../../tree/src/api'
import { DIVIDER, menu, type MenuEntry } from '../../ui-kit/src/api'
import { patchTodos, removeTodos, tickTodos } from './acts'
import type { Shown } from './shown.svelte'

export interface RowsHost {
  shown: Shown
  order: () => readonly Todo[]
  opened: () => string | null
  open: (id: string | null) => void
  move?: (id: string, by: number) => Promise<void>
}
const DAYS: readonly [string, number | null][] = [
  ['Today', 0],
  ['Tomorrow', 1],
  ['In a week', 7],
  ['None', null],
]
const rowOf = (event: Event): HTMLElement | null =>
  event.target instanceof Element ? event.target.closest<HTMLElement>('[data-todo]') : null
export class TodoRows {
  readonly picking = new Selection()
  constructor(private readonly host: RowsHost) {}
  private ids(): string[] {
    return this.host
      .order()
      .map((one) => one.id)
      .filter((one, at, all) => all.indexOf(one) === at)
  }
  keep() {
    const shown = this.ids()
    if (!this.picking.paths.every((id) => shown.includes(id))) this.picking.keepOnly((id) => shown.includes(id))
  }
  click(event: MouseEvent, id: string): boolean {
    if (event.shiftKey) this.picking.range(id, this.ids())
    else if (event.altKey || event.metaKey || event.ctrlKey) this.picking.toggle(id)
    else {
      this.picking.select(id)
      return false
    }
    return true
  }
  group(id: string): Todo[] {
    const going = this.picking.dragging(id)
    return this.host.order().filter((one, at, all) => going.includes(one.id) && all.indexOf(one) === at)
  }
  private targets(id: string | null): string[] {
    if (id !== null && !this.picking.has(id)) return [id]
    return [...this.picking.paths]
  }
  letGo() {
    this.picking.clear()
    const at = document.activeElement
    if (at instanceof HTMLElement && at.closest('[data-todo]')) at.blur()
  }
  tick(id: string, done: boolean): Promise<void> {
    return tickTodos(this.host.shown, this.targets(id), done)
  }
  async remove(ids: readonly string[]): Promise<void> {
    if (!(await removeTodos(ids))) return
    const opened = this.host.opened()
    if (opened !== null && ids.includes(opened)) this.host.open(null)
    this.picking.clear()
  }
  menu(event: MouseEvent, todo: Todo) {
    if (!this.picking.has(todo.id)) this.picking.select(todo.id)
    const going = this.targets(todo.id)
    const many = going.length > 1
    const chosen = this.host.order().filter((one) => going.includes(one.id))
    const done = !chosen.every((one) => one.done)
    const set = (patch: TodoPatch) => () => void patchTodos(going, patch)
    const today = this.host.shown.filter.today
    const days = (key: 'start' | 'deadline') => (): Promise<MenuEntry[]> =>
      Promise.resolve(
        DAYS.map(([label, ahead]) => ({ label, run: set({ [key]: ahead === null ? null : dayAfter(today, ahead) }) })),
      )
    const items: MenuEntry[] = [
      ...(many ? [] : [{ label: 'Open', run: () => this.host.open(todo.id) }]),
      {
        label: done
          ? many
            ? `Mark ${String(going.length)} as done`
            : 'Mark as done'
          : many
            ? `Mark ${String(going.length)} as not done`
            : 'Mark as not done',
        run: () => void tickTodos(this.host.shown, going, done),
      },
      {
        label: 'Label',
        run: () => undefined,
        more: () =>
          Promise.resolve([
            ...this.host.shown.labels.map((label) => ({ label, run: set({ labels: [label] }) })),
            { label: 'No label', run: set({ labels: [] }) },
          ]),
      },
      {
        label: 'Priority',
        run: () => undefined,
        more: () =>
          Promise.resolve(
            [...PRIORITIES].reverse().map((priority) => ({ label: PRIORITY_NAMES[priority], run: set({ priority }) })),
          ),
      },
      { label: 'Start date', run: () => undefined, more: days('start') },
      { label: 'Deadline', run: () => undefined, more: days('deadline') },
      DIVIDER,
      {
        label: many ? `Delete ${String(going.length)} todos` : 'Delete',
        danger: true,
        hint: shortcuts.hint('tree.delete'),
        run: () => void this.remove(going),
      },
    ]
    menu.show(event, items, { title: many ? `${String(going.length)} todos` : todo.title })
  }
  private step(list: HTMLElement, from: HTMLElement | null, by: number): string | null {
    const rows = [...list.querySelectorAll<HTMLElement>('[data-todo]')]
    const at = from ? rows.indexOf(from) : -1
    const next = rows[Math.min(rows.length - 1, Math.max(0, at + by))]
    next?.querySelector<HTMLElement>('.body')?.focus()
    return next?.dataset.todo ?? null
  }
  key(event: KeyboardEvent, list: HTMLElement) {
    const from = event.target instanceof Element ? event.target : null
    if (from?.closest('input, textarea, [contenteditable], [data-todo-editor]')) return
    const row = rowOf(event)
    const here = row?.dataset.todo ?? null
    if (shortcuts.pressed('tree.select-all', event)) {
      event.preventDefault()
      this.picking.all(this.ids())
    } else if (shortcuts.pressed('tree.deselect', event) && this.picking.paths.length) {
      event.preventDefault()
      event.stopPropagation()
      this.letGo()
    } else if (shortcuts.pressed('tree.delete', event) || shortcuts.pressed('tree.delete.alt', event)) {
      const going = this.targets(here)
      if (!going.length) return
      event.preventDefault()
      void this.remove(going)
    } else if (shortcuts.pressed('tree.down', event) || shortcuts.pressed('tree.up', event)) {
      event.preventDefault()
      this.step(list, row, shortcuts.pressed('tree.down', event) ? 1 : -1)
    } else if (shortcuts.pressed('tree.extend-down', event) || shortcuts.pressed('tree.extend-up', event)) {
      event.preventDefault()
      const next = this.step(list, row, shortcuts.pressed('tree.extend-down', event) ? 1 : -1)
      if (here !== null && next !== null) this.picking.extend(here, next, this.ids())
    } else if (
      (shortcuts.pressed('tree.move-up', event) || shortcuts.pressed('tree.move-down', event)) &&
      here !== null
    ) {
      event.preventDefault()
      const by = shortcuts.pressed('tree.move-down', event) ? 1 : -1
      void this.host
        .move?.(here, by)
        .then(() =>
          requestAnimationFrame(() =>
            list.querySelector<HTMLElement>(`[data-todo="${CSS.escape(here)}"] .body`)?.focus(),
          ),
        )
    } else if (shortcuts.pressed('tree.toggle', event) && here !== null) {
      event.preventDefault()
      this.picking.toggle(here)
    }
  }
}
export function rowKeys(node: HTMLElement, rows: TodoRows) {
  const heard = (event: KeyboardEvent) => rows.key(event, node)
  const pressed = (event: MouseEvent) => {
    if (event.target instanceof Element && !event.target.closest('[data-todo], [data-todo-editor]'))
      rows.picking.clear()
  }
  const away = (event: KeyboardEvent) => {
    const at = event.target instanceof Element ? event.target : null
    if (event.defaultPrevented || at?.closest('input, textarea, [contenteditable]')) return
    if (shortcuts.pressed('tree.deselect', event) && rows.picking.paths.length) rows.letGo()
  }
  node.addEventListener('keydown', heard)
  node.addEventListener('click', pressed)
  window.addEventListener('keydown', away)
  return {
    destroy: () => {
      node.removeEventListener('keydown', heard)
      node.removeEventListener('click', pressed)
      window.removeEventListener('keydown', away)
    },
  }
}
export function rowMenu(node: HTMLElement, show: (event: MouseEvent) => void) {
  node.addEventListener('contextmenu', show)
  return { destroy: () => node.removeEventListener('contextmenu', show) }
}
