import { portOf } from '@orden/contracts'
import {
  ALL_LABELS,
  dayOf,
  type Filter,
  type Group,
  groupedByLabel,
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
  spaces(): readonly Space[]
  today(): string
  kept(): unknown
  keep(value: unknown): void
}

interface Kept {
  onlySpace: boolean
  sort: Sort
}

function keptOf(value: unknown): Kept {
  const read = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    onlySpace: read.onlySpace === true,
    sort: isSort(read.sort) ? read.sort : 'deadline',
  }
}

export class Shown {
  onlySpace = $state(false)
  label = $state<string | null>(ALL_LABELS)
  sort = $state<Sort>('deadline')

  constructor(private readonly world: ShownWorld) {
    const kept = keptOf(world.kept())
    this.onlySpace = kept.onlySpace
    this.sort = kept.sort
  }

  private remember(): void {
    this.world.keep({ onlySpace: this.onlySpace, sort: this.sort })
  }

  setOnlySpace(value: boolean): void {
    this.onlySpace = value
    this.remember()
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

  get spaces(): readonly Space[] {
    return this.world.spaces()
  }

  get filter(): Filter {
    const label = this.label
    return {
      onlySpace: this.onlySpace,
      space: this.space?.id ?? null,
      label: label !== null && this.labels.includes(label) ? label : ALL_LABELS,
      today: this.world.today(),
    }
  }

  get labels(): string[] {
    return labelsOf(this.world.todos(), {
      onlySpace: this.onlySpace,
      space: this.space?.id ?? null,
      today: this.world.today(),
    })
  }

  get todos(): Todo[] {
    return sortedTodos(shownTodos(this.world.todos(), this.filter), this.sort)
  }

  get groups(): Group[] {
    return groupedByLabel(this.todos)
  }

  spaceName(id: string | null): string | null {
    if (id === null) return null
    return this.spaces.find((one) => one.id === id)?.name ?? null
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
    spaces: () => (workspace()?.spaces ?? []).map((one) => ({ id: one.id, name: one.name })),
    today: () => dayOf(),
    kept: () => storage()?.json(KEPT),
    keep: (value) => void storage()?.keepJson(KEPT, value),
  }
}
