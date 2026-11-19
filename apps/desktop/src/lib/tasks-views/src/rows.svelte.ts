import { shortcuts } from '../../shortcuts/src/api'
import type { Todo } from '../../tasks-model/src/api'
import { DIVIDER, menu, type MenuEntry } from '../../ui-kit/src/api'
import { patchTodo, removeTodos } from './acts'
import { Picking, pickOf } from './picking.svelte'

export interface RowsHost {
  order: () => readonly Todo[]
  opened: () => string | null
  open: (id: string | null) => void
}
const rowOf = (event: Event): HTMLElement | null =>
  event.target instanceof Element ? event.target.closest<HTMLElement>('[data-todo]') : null
export class TodoRows {
  readonly picking = new Picking()
  constructor(private readonly host: RowsHost) {}
  private ids(): string[] {
    return this.host
      .order()
      .map((one) => one.id)
      .filter((one, at, all) => all.indexOf(one) === at)
  }
  keep() {
    this.picking.keep(this.ids())
  }
  click(event: MouseEvent, id: string): boolean {
    const how = pickOf(event)
    if (how === 'plain') {
      this.picking.clear()
      return false
    }
    if (how === 'toggle') this.picking.toggle(id)
    else this.picking.range(this.ids(), id)
    return true
  }
  private targets(id: string | null): string[] {
    if (id !== null && !this.picking.has(id)) return [id]
    return [...this.picking.ids]
  }
  async remove(ids: readonly string[]): Promise<void> {
    if (!(await removeTodos(ids))) return
    const opened = this.host.opened()
    if (opened !== null && ids.includes(opened)) this.host.open(null)
    this.picking.clear()
  }
  menu(event: MouseEvent, todo: Todo) {
    if (!this.picking.has(todo.id)) this.picking.clear()
    const going = this.targets(todo.id)
    const many = going.length > 1
    const chosen = this.host.order().filter((one) => going.includes(one.id))
    const done = !chosen.every((one) => one.done)
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
        run: () => void Promise.all(going.map((id) => patchTodo(id, { done }))),
      },
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
    } else if (shortcuts.pressed('tree.deselect', event) && this.picking.ids.length) {
      event.preventDefault()
      event.stopPropagation()
      this.picking.clear()
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
      if (here !== null && !this.picking.ids.length) this.picking.only(here)
      const next = this.step(list, row, shortcuts.pressed('tree.extend-down', event) ? 1 : -1)
      if (next !== null) this.picking.range(this.ids(), next)
    } else if (shortcuts.pressed('tree.toggle', event) && here !== null) {
      event.preventDefault()
      this.picking.toggle(here)
    }
  }
}
export function rowKeys(node: HTMLElement, rows: TodoRows) {
  const heard = (event: KeyboardEvent) => rows.key(event, node)
  node.addEventListener('keydown', heard)
  return { destroy: () => node.removeEventListener('keydown', heard) }
}
export function rowMenu(node: HTMLElement, show: (event: MouseEvent) => void) {
  node.addEventListener('contextmenu', show)
  return { destroy: () => node.removeEventListener('contextmenu', show) }
}
