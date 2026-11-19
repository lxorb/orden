import { type Grouping, movedPatch, type Todo } from '../../tasks-model/src/api'
import { carryTodo, carryTodoColumn, dragged, isTodoColumnDrag, isTodoDrag, isTreeDrag } from '../../ui-kit/src/api'
import { linkNotes, patchTodo, placeTodo } from './acts'
import type { Shown } from './shown.svelte'
import { placeOf, type Spot, TodoDrag } from './todo-drag.svelte'
import { touchLift } from './touch-lift'

export interface CarryHost {
  shown: Shown
  list(column: string): readonly Todo[]
  grouping(): Grouping | null
  columns?(): readonly string[]
}
type Dropping = Awaited<ReturnType<(typeof import('../../tab-strip/src/api'))['spaceDropping']>>
let drop: Dropping | null = null
const dropping = (): Promise<Dropping> =>
  import('../../tab-strip/src/api').then((one) => one.spaceDropping()).then((one) => (drop = one))
const nameOf = (path: string): string => (path.split('/').pop() ?? path).replace(/\.md$/i, '')
const shared = new TodoDrag()
export class Carrying {
  readonly drag = shared
  taking = $state<string | null>(null)
  constructor(private readonly host: CarryHost) {}
  private toSpace(id: string) {
    const spaceOf = (space: string) =>
      this.host.shown.spaces.find((one) => one.id === space || (one.also?.includes(space) ?? false))?.id ?? space
    return { to: (space: string) => void patchTodo(id, { space: spaceOf(space) }) }
  }
  started(todo: Todo, column: string): void {
    this.drag.start(todo, column)
  }
  aim(column: string, beside: string | null, after: boolean): void {
    if (beside !== null && beside === this.drag.todo?.id) return
    this.drag.over(column, this.host.list(column), beside, after)
  }
  async land(): Promise<void> {
    const { todo, spot, from } = this.drag
    if (!todo || !spot || from === null) this.drag.clear()
    else await this.drag.settle(this.put(todo, spot, from))
  }
  private async put(todo: Todo, spot: Spot, from: string): Promise<void> {
    const shown = this.host.shown
    const list = this.host.list(spot.column)
    const without = list.filter((one) => one.id !== todo.id)
    const at = Math.max(0, Math.min(without.length, spot.at))
    const placed = [...without.slice(0, at), todo, ...without.slice(at)]
    const grouping = this.host.grouping()
    if (grouping !== null && spot.column !== from) {
      const patch = movedPatch(todo, grouping, from, spot.column, shown.filter.today)
      if (patch) await patchTodo(todo.id, patch)
      if (shown.sort !== 'manual') return
    } else if (list.findIndex((one) => one.id === todo.id) === at) return
    if (shown.sort !== 'manual') shown.setSort('manual')
    await placeTodo(placed, todo.id)
  }
  async step(column: string, id: string, by: number): Promise<void> {
    const list = [...this.host.list(column)]
    const at = list.findIndex((one) => one.id === id)
    const to = at + by
    const moving = list[at]
    if (at === -1 || to < 0 || to >= list.length || !moving) return
    list.splice(at, 1)
    list.splice(to, 0, moving)
    const shown = this.host.shown
    if (shown.sort !== 'manual') shown.setSort('manual')
    await placeTodo(list, id)
  }
  card = (node: HTMLElement, given: { todo: Todo; column: string }) => {
    let { todo, column } = given
    node.draggable = true
    node.dataset.todoCard = todo.id
    const start = (event: DragEvent) => {
      if (event.target instanceof Element && event.target.closest('input, textarea')) {
        event.preventDefault()
        return
      }
      carryTodo(event.dataTransfer, todo.id, todo.title)
      this.started(todo, column)
      const carried = this.toSpace(todo.id)
      void dropping().then((one) => {
        if (this.drag.todo?.id === todo.id) one.followDrag(carried)
      })
    }
    const end = () => {
      if (this.drag.on && !this.drag.settling) this.drag.clear()
      this.taking = null
    }
    const over = (event: DragEvent) => {
      if (isTodoDrag(event.dataTransfer) && this.drag.on) {
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        this.aim(column, todo.id, placeOf(event.clientY, node.getBoundingClientRect()) === 'after')
      } else if (isTreeDrag(event.dataTransfer)) {
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
        this.taking = todo.id
      }
    }
    const leave = (event: DragEvent) => {
      if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return
      if (this.taking === todo.id) this.taking = null
    }
    const dropped = (event: DragEvent) => {
      if (isTreeDrag(event.dataTransfer)) {
        event.preventDefault()
        event.stopPropagation()
        this.taking = null
        void linkNotes(
          todo,
          dragged(event.dataTransfer)
            .filter((one) => /\.md$/i.test(one))
            .map(nameOf),
        )
        return
      }
      if (!isTodoDrag(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      void this.land()
    }
    node.addEventListener('dragstart', start)
    node.addEventListener('dragend', end)
    node.addEventListener('dragover', over)
    node.addEventListener('dragenter', over)
    node.addEventListener('dragleave', leave)
    node.addEventListener('drop', dropped)
    const lift = touchLift(node, {
      start: () => {
        this.started(todo, column)
        void dropping()
        return true
      },
      over: (x, y, under) => {
        if (drop?.overSpaces(this.toSpace(todo.id), { x, y })) return
        const card = under?.closest<HTMLElement>('[data-todo-card]')
        const area = under?.closest<HTMLElement>('[data-todo-column]')
        if (card && area) {
          const beside = card.dataset.todoCard ?? null
          this.aim(area.dataset.todoColumn ?? '', beside, placeOf(y, card.getBoundingClientRect()) === 'after')
        } else if (area) this.aim(area.dataset.todoColumn ?? '', null, true)
      },
      land: () => {
        if (drop?.droppedOnSpace(this.toSpace(todo.id))) {
          this.drag.clear()
          return
        }
        void this.land()
      },
      cancel: () => {
        drop?.leftSpaces()
        this.drag.clear()
      },
    })
    return {
      update(next: { todo: Todo; column: string }) {
        todo = next.todo
        column = next.column
        node.dataset.todoCard = todo.id
      },
      destroy() {
        lift.destroy()
        node.removeEventListener('dragstart', start)
        node.removeEventListener('dragend', end)
        node.removeEventListener('dragover', over)
        node.removeEventListener('dragenter', over)
        node.removeEventListener('dragleave', leave)
        node.removeEventListener('drop', dropped)
      },
    }
  }
  area = (node: HTMLElement, column: string) => {
    let key = column
    const over = (event: DragEvent) => {
      if (!isTodoDrag(event.dataTransfer) || !this.drag.on) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      this.aim(key, null, true)
    }
    const dropped = (event: DragEvent) => {
      if (!isTodoDrag(event.dataTransfer)) return
      event.preventDefault()
      void this.land()
    }
    node.dataset.todoColumn = key
    node.addEventListener('dragover', over)
    node.addEventListener('dragenter', over)
    node.addEventListener('drop', dropped)
    return {
      update(next: string) {
        key = next
        node.dataset.todoColumn = key
      },
      destroy() {
        node.removeEventListener('dragover', over)
        node.removeEventListener('dragenter', over)
        node.removeEventListener('drop', dropped)
      },
    }
  }
  head = (node: HTMLElement, key: string) => {
    let mine = key
    node.draggable = true
    const start = (event: DragEvent) => {
      if (event.target instanceof Element && event.target.closest('button, input')) {
        event.preventDefault()
        return
      }
      carryTodoColumn(event.dataTransfer, mine)
      this.drag.startColumn(mine)
    }
    const end = () => {
      if (!this.drag.settling) this.drag.clear()
    }
    node.addEventListener('dragstart', start)
    node.addEventListener('dragend', end)
    return {
      update(next: string) {
        mine = next
      },
      destroy() {
        node.removeEventListener('dragstart', start)
        node.removeEventListener('dragend', end)
      },
    }
  }
  row = (node: HTMLElement, moveColumn: (key: string, at: number) => Promise<unknown>) => {
    let move = moveColumn
    const at = (x: number): number => {
      const columns = [...node.querySelectorAll<HTMLElement>('[data-todos-column]')].filter(
        (one) => one.dataset.key !== this.drag.column,
      )
      const index = columns.findIndex((one) => {
        const box = one.getBoundingClientRect()
        return x < box.left + box.width / 2
      })
      return index === -1 ? columns.length : index
    }
    const over = (event: DragEvent) => {
      if (!isTodoColumnDrag(event.dataTransfer) || this.drag.column === null) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      this.drag.overColumn(at(event.clientX))
    }
    const dropped = (event: DragEvent) => {
      if (!isTodoColumnDrag(event.dataTransfer)) return
      event.preventDefault()
      const key = this.drag.column
      const to = this.drag.columnAt
      if (key === null || to === null) this.drag.clear()
      else void this.drag.settle(move(key, to))
    }
    node.addEventListener('dragover', over)
    node.addEventListener('dragenter', over)
    node.addEventListener('drop', dropped)
    return {
      update(next: (key: string, at: number) => Promise<unknown>) {
        move = next
      },
      destroy() {
        node.removeEventListener('dragover', over)
        node.removeEventListener('dragenter', over)
        node.removeEventListener('drop', dropped)
      },
    }
  }
}
export function columnPreview<T extends { key: string }>(columns: readonly T[], drag: TodoDrag): T[] {
  const key = drag.column
  const at = drag.columnAt
  if (key === null || at === null) return [...columns]
  const moving = columns.find((one) => one.key === key)
  if (!moving) return [...columns]
  const without = columns.filter((one) => one.key !== key)
  const place = Math.max(0, Math.min(without.length, at))
  return [...without.slice(0, place), moving, ...without.slice(place)]
}
