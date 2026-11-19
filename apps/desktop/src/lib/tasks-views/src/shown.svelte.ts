import { portOf } from '@orden/contracts'
import {
  ALL_LABELS,
  type Board,
  type Column,
  columnsOf,
  type Grouping,
  movedColumns,
  orderedColumns,
  todos as held,
  dayOf,
  type Filter,
  isSort,
  labelsOf,
  shownTodos,
  type Sort,
  sortedTodos,
  type Todo,
} from '../../tasks-model/src/api'

export const SORT_NAMES: Readonly<Record<Sort, string>> = {
  deadline: 'Deadline',
  priority: 'Priority',
  manual: 'Manual',
}
export interface Space {
  readonly id: string
  readonly name: string
}
export interface ShownWorld {
  todos(): readonly Todo[]
  activeSpace(): Space | null
  today(): string
  kept(): unknown
  keep(value: unknown): void
  board(): Board
  arrange(board: Board): unknown
}
export type Where = 'panel' | 'board'
interface Kept {
  sort: Sort
  done: boolean
}
const LINGER = 900
function keptOf(value: unknown): Kept {
  const read = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    sort: isSort(read.sort) ? read.sort : 'deadline',
    done: read.done === true,
  }
}
export class Shown {
  label = $state<string | null>(ALL_LABELS)
  sort = $state<Sort>('deadline')
  lingering = $state<readonly string[]>([])
  private panelDone = $state(false)
  constructor(
    private readonly world: ShownWorld,
    readonly where: Where = 'panel',
  ) {
    const kept = keptOf(world.kept())
    this.sort = kept.sort
    this.panelDone = kept.done
  }
  private remember(): void {
    this.world.keep({ sort: this.sort, done: this.panelDone })
  }
  get showDone(): boolean {
    return this.where === 'board' ? this.world.board().done : this.panelDone
  }
  setShowDone(value: boolean): void {
    if (this.where === 'board') this.world.arrange({ ...this.world.board(), done: value })
    else {
      this.panelDone = value
      this.remember()
    }
  }
  get anyStart(): boolean {
    return this.where === 'board' && this.world.board().anyStart
  }
  setAnyStart(value: boolean): void {
    this.world.arrange({ ...this.world.board(), anyStart: value })
  }
  get grouping(): Grouping {
    return this.world.board().grouping
  }
  setGrouping(value: Grouping): void {
    this.world.arrange({ ...this.world.board(), grouping: value })
  }
  linger(id: string, ms = LINGER): void {
    this.lingering = [...this.lingering.filter((one) => one !== id), id]
    setTimeout(() => (this.lingering = this.lingering.filter((one) => one !== id)), ms)
  }
  get columns(): Column[] {
    const grouping = this.grouping
    return orderedColumns(columnsOf(this.todos, grouping, this.world.today()), this.world.board().columns[grouping])
  }
  async moveColumn(key: string, to: number): Promise<void> {
    const board = this.world.board()
    const keys = movedColumns(
      this.columns.map((one) => one.key),
      key,
      to,
    )
    await this.world.arrange({ ...board, columns: { ...board.columns, [board.grouping]: keys } })
  }
  setSort(value: Sort): void {
    this.sort = value
    this.remember()
  }
  setLabel(value: string | null): void {
    this.label = value
  }
  get space(): Space | null {
    return this.world.activeSpace()
  }
  get filter(): Filter {
    const label = this.label
    return {
      label: label !== null && this.labels.includes(label) ? label : ALL_LABELS,
      today: this.world.today(),
      done: this.showDone,
      anyStart: this.anyStart,
      keep: this.lingering,
    }
  }
  get labels(): string[] {
    const today = this.world.today()
    const shown = shownTodos(this.world.todos(), {
      label: ALL_LABELS,
      today,
      done: this.showDone,
      anyStart: this.anyStart,
      keep: this.lingering,
    })
    return labelsOf(shown, { today, done: true })
  }
  get todos(): Todo[] {
    return sortedTodos(shownTodos(this.world.todos(), this.filter), this.sort, this.lingering)
  }
}
const KEPT = 'orden:todos-shown'
export function shellWorld(todos: () => readonly Todo[]): ShownWorld {
  const workspace = () => {
    const port = portOf('sync.workspace')
    return port.ok ? port.value : null
  }
  const storage = () => {
    const port = portOf('sync.storage')
    return port.ok ? port.value : null
  }
  return {
    todos,
    activeSpace: () => {
      const space = workspace()?.activeSpace ?? null
      return space ? { id: space.id, name: space.name } : null
    },
    today: () => dayOf(),
    kept: () => storage()?.json(KEPT),
    keep: (value) => void storage()?.keepJson(KEPT, value),
    board: () => held.board,
    arrange: (board) => held.arrange(board),
  }
}
