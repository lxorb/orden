import type { Todo } from '../../tasks-model/src/api'
import { scrollerOf } from '../../ui-kit/src/api'
import { autoScrollBy } from '../../windows/src/api'

export interface Spot {
  readonly column: string
  readonly at: number
}
const EDGE = 40
const MOST = 14
export const placeOf = (y: number, box: { top: number; height: number }): 'before' | 'after' =>
  y > box.top + box.height / 2 ? 'after' : 'before'
export function previewed(list: readonly Todo[], column: string, drag: TodoDrag): Todo[] {
  const carried = drag.todo
  if (!carried) return [...list]
  const without = list.filter((one) => one.id !== carried.id)
  const spot = drag.spot
  if (spot?.column !== column) return drag.from === column && drag.leaves ? without : [...list]
  const at = Math.max(0, Math.min(without.length, spot.at))
  return [...without.slice(0, at), carried, ...without.slice(at)]
}
export class TodoDrag {
  todo = $state<Todo | null>(null)
  from = $state<string | null>(null)
  spot = $state<Spot | null>(null)
  leaves = $state(true)
  column = $state<string | null>(null)
  columnAt = $state<number | null>(null)
  get on(): boolean {
    return this.todo !== null
  }
  start(todo: Todo, from: string, leaves = true): void {
    this.todo = todo
    this.from = from
    this.leaves = leaves
    this.spot = null
  }
  over(column: string, list: readonly Todo[], beside: string | null, after: boolean): void {
    const carried = this.todo
    if (!carried) return
    const without = list.filter((one) => one.id !== carried.id)
    const index = beside === null ? without.length : without.findIndex((one) => one.id === beside)
    const at = index === -1 ? without.length : index + (after ? 1 : 0)
    if (this.spot?.column === column && this.spot.at === at) return
    this.spot = { column, at }
  }
  startColumn(key: string): void {
    this.column = key
    this.columnAt = null
  }
  overColumn(at: number): void {
    if (this.columnAt !== at) this.columnAt = at
  }
  clear(): void {
    this.todo = null
    this.from = null
    this.spot = null
    this.column = null
    this.columnAt = null
  }
}
export function edgeScroll(node: HTMLElement, axis: 'x' | 'y' = 'y') {
  let at: number | null = null
  let rolling: number | null = null
  const scrolls = (one: HTMLElement) =>
    axis === 'x' ? one.scrollWidth > one.clientWidth : one.scrollHeight > one.clientHeight
  const target = (): HTMLElement => (axis === 'x' || scrolls(node) ? node : (scrollerOf(node) ?? node))
  const roll = () => {
    if (at === null) {
      rolling = null
      return
    }
    const box = target()
    const room = axis === 'y' ? box.clientHeight : box.clientWidth
    const step = autoScrollBy(at, room, EDGE, MOST)
    if (step !== 0) {
      if (axis === 'y') box.scrollTop += step
      else box.scrollLeft += step
    }
    rolling = requestAnimationFrame(roll)
  }
  const follow = (x: number, y: number) => {
    const box = target().getBoundingClientRect()
    at = axis === 'y' ? y - box.top : x - box.left
    rolling ??= requestAnimationFrame(roll)
  }
  const stop = () => {
    at = null
    if (rolling !== null) cancelAnimationFrame(rolling)
    rolling = null
  }
  const over = (event: DragEvent) => follow(event.clientX, event.clientY)
  const left = (event: DragEvent) => {
    const box = node.getBoundingClientRect()
    const out =
      event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom
    if (out) stop()
  }
  const touched = (event: Event) => {
    const point = (event as CustomEvent<{ x: number; y: number } | null>).detail
    if (point) follow(point.x, point.y)
    else stop()
  }
  node.addEventListener('dragenter', over)
  node.addEventListener('dragover', over)
  node.addEventListener('dragleave', left)
  node.addEventListener('drop', stop)
  window.addEventListener('dragend', stop)
  node.addEventListener('orden-todo-lift', touched)
  return {
    destroy() {
      stop()
      node.removeEventListener('dragenter', over)
      node.removeEventListener('dragover', over)
      node.removeEventListener('dragleave', left)
      node.removeEventListener('drop', stop)
      window.removeEventListener('dragend', stop)
      node.removeEventListener('orden-todo-lift', touched)
    },
  }
}
