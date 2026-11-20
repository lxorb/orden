import { err, failure, ok, type Result } from '@orden/contracts'
import { type Kept, TodoRecords, type TodoDisk, type TodoServer } from './records'
import { dayOf, nextOrder } from './query'
import { type Board, BOARD_ID, boardFields, boardOf } from './board'
import { checkedPatch, fieldsOf, fitsOneChange, KIND, newId, type Todo, todoOf, type TodoPatch } from './todo'

const SEND_AFTER = 1500
export interface OpenedDisk extends TodoDisk {
  close(): void
  clear(): Promise<void>
}
export interface Opening {
  readonly owner: string | null
  readonly server: TodoServer | null
  readonly device: string
}
export interface StoreWorld {
  openDisk(owner: string | null): Promise<OpenedDisk>
  now(): number
  channel(name: string):
    | (Pick<BroadcastChannel, 'postMessage' | 'close'> & {
        onmessage: ((event: MessageEvent) => void) | null
      })
    | null
  warn(message: string): void
  later(run: () => void, ms: number): () => void
}
const missing = (what: string) => err(failure('tasks-model', 'missing', what))
const refused = (what: string) => err(failure('tasks-model', 'invalid', what))
const RULE = 'repeat is a rule like "every 3 days" or "every! 10 days"'
interface Moved {
  readonly copy: string
  readonly was: Pick<Todo, 'start' | 'deadline' | 'repeat' | 'subtasks'>
}
async function ruled(patch: TodoPatch): Promise<Result<TodoPatch>> {
  if (typeof patch.repeat !== 'string') return ok(patch)
  const { parseRule, ruleText } = await import('@orden/bases')
  const rule = parseRule(patch.repeat)
  return rule ? ok({ ...patch, repeat: ruleText(rule) }) : refused(RULE)
}
export class TodoStore {
  todos = $state<readonly Todo[]>([])
  board = $state<Board>(boardOf(null))
  answers = $state<boolean | null>(null)
  openedFor = $state<string | null | undefined>(undefined)
  private records: TodoRecords | null = null
  private moved: readonly (Moved & { readonly id: string })[] = []
  private ticking: readonly string[] = []
  private disk: OpenedDisk | null = null
  private owner: string | null | undefined = undefined
  private server: TodoServer | null = null
  private device = 'device'
  private opening: Promise<void> = Promise.resolve()
  private exchanging: Promise<boolean> | null = null
  private again = false
  private channel: ReturnType<StoreWorld['channel']> = null
  private cancelSend: () => void = () => undefined
  private readonly listeners: (() => void)[] = []
  constructor(private readonly world: StoreWorld) {}
  opened(how: Opening): Promise<void> {
    this.server = how.server
    this.device = how.device
    if (how.owner === this.owner) {
      if (this.server) void this.opening.then(() => this.exchange())
      return this.opening
    }
    this.owner = how.owner
    this.opening = this.opening
      .then(() => this.switchTo(how.owner))
      .catch((error: unknown) => {
        this.world.warn(`the todos did not open: ${String(error)}`)
      })
    return this.opening
  }
  private async switchTo(owner: string | null): Promise<void> {
    this.channel?.close()
    this.channel = null
    this.disk?.close()
    this.disk = null
    this.records = null
    this.answers = null
    this.openedFor = undefined
    this.todos = []
    const channel = this.world.channel(`orden-todos:${owner ?? ''}`)
    const early = { heard: false }
    let loaded: TodoRecords | null = null
    if (channel) {
      channel.onmessage = () => {
        if (loaded) void loaded.load()
        else early.heard = true
      }
    }
    const disk = await this.world.openDisk(owner)
    const records = new TodoRecords(disk, this.device, () => this.world.now())
    await records.load()
    const carried = owner !== null && (await this.carry(records))
    if (this.owner !== owner) {
      channel?.close()
      disk.close()
      return
    }
    this.disk = disk
    this.records = records
    this.channel = channel
    records.hear(() => this.told())
    loaded = records
    if (early.heard) void records.load()
    if (carried) channel?.postMessage('changed')
    this.openedFor = owner
    this.told()
    if (this.server) void this.exchange()
  }
  private async carry(into: TodoRecords): Promise<boolean> {
    const local = await this.world.openDisk(null)
    try {
      const items: Kept[] = await local.items()
      if (!items.length) return false
      await into.adopt(items)
      await local.clear()
      return true
    } finally {
      local.close()
    }
  }
  private told(): void {
    const records = this.records
    this.board = boardOf(records?.fieldsOf(BOARD_ID) ?? null)
    this.todos = records
      ? records
          .entries()
          .map(({ id, fields }) => todoOf(id, fields))
          .filter((one): one is Todo => one !== null)
      : []
    for (const listener of [...this.listeners]) listener()
  }
  hear(listener: () => void): () => void {
    this.listeners.push(listener)
    return () => {
      const at = this.listeners.indexOf(listener)
      if (at !== -1) this.listeners.splice(at, 1)
    }
  }
  private wrote(): void {
    this.channel?.postMessage('changed')
    if (this.server) {
      this.cancelSend()
      this.cancelSend = this.world.later(() => void this.exchange(), SEND_AFTER)
    }
  }
  todo(id: string): Todo | null {
    return this.todos.find((one) => one.id === id) ?? null
  }
  async add(patch: TodoPatch & { title: string }): Promise<Result<Todo>> {
    const records = this.records
    if (!records) return missing('the todos are not open yet')
    const plain = checkedPatch(patch)
    const checked = plain.ok ? await ruled(plain.value) : plain
    if (!checked.ok) return checked
    const id = newId()
    const now = this.world.now()
    const fields = fieldsOf({
      description: '',
      labels: [],
      start: null,
      deadline: null,
      priority: 0,
      done: false,
      subtasks: [],
      repeat: null,
      order: nextOrder(this.todos),
      ...checked.value,
    })
    const whole = { ...fields, kind: KIND, created: now, doneAt: null }
    const fits = fitsOneChange(id, whole, this.device)
    if (!fits.ok) return fits
    await records.change([{ id, fields: whole }])
    this.wrote()
    const made = this.todo(id)
    return made ? ok(made) : missing('the todo was not kept')
  }
  async update(id: string, patch: TodoPatch): Promise<Result<Todo>> {
    const records = this.records
    if (!records) return missing('the todos are not open yet')
    const was = this.todo(id)
    if (!was) return missing(`no todo ${id}`)
    if (patch.done === true && !was.done && was.repeat !== null) {
      const tick = `${was.id}\n${was.start ?? ''}\n${was.deadline ?? ''}`
      if (this.ticking.includes(tick)) return ok(was)
      this.ticking = [...this.ticking, tick]
      try {
        return await this.ticked({ ...was, repeat: was.repeat }, patch)
      } finally {
        this.ticking = this.ticking.filter((one) => one !== tick)
      }
    }
    return this.patched(was, patch)
  }
  private async ticked(was: Todo & { repeat: string }, patch: TodoPatch): Promise<Result<Todo>> {
    const { doneCopyId, nextRepeat } = await import('@orden/bases/occurrence')
    const now = this.todo(was.id)
    if (!now || now.done || now.start !== was.start || now.deadline !== was.deadline) {
      return now ? ok(now) : missing(`no todo ${was.id}`)
    }
    const today = dayOf(this.world.now())
    const next = nextRepeat({ repeat: was.repeat, start: was.start, deadline: was.deadline }, today)
    if (!next) return this.patched(was, patch)
    const plain = checkedPatch(patch)
    const checked = plain.ok ? await ruled(plain.value) : plain
    if (!checked.ok) return checked
    return this.moveOn(was, checked.value, next, doneCopyId(was, today))
  }
  private async patched(was: Todo, patch: TodoPatch): Promise<Result<Todo>> {
    const records = this.records
    if (!records) return missing('the todos are not open yet')
    const id = was.id
    const plain = checkedPatch(patch)
    const checked = plain.ok ? await ruled(plain.value) : plain
    if (!checked.ok) return checked
    const back = this.moved.find((one) => one.id === id)
    if (checked.value.done === false && !was.done && back) return this.moveBack(id, back)
    const fields = fieldsOf(checked.value)
    if (checked.value.done !== undefined && checked.value.done !== was.done) {
      fields.doneAt = checked.value.done ? this.world.now() : null
    }
    if (!Object.keys(fields).length) return ok(was)
    const fits = fitsOneChange(id, { ...records.fieldsOf(id), ...fields }, this.device)
    if (!fits.ok) return fits
    await records.change([{ id, fields }])
    this.wrote()
    const now = this.todo(id)
    return now ? ok(now) : missing(`no todo ${id}`)
  }
  private async moveOn(
    was: Todo,
    patch: TodoPatch,
    next: { repeat: string; start: string | null; deadline: string | null },
    copy: string,
  ): Promise<Result<Todo>> {
    const records = this.records
    if (!records) return missing('the todos are not open yet')
    const now = this.world.now()
    const { title, description, labels, start, deadline, priority, subtasks, order } = was
    const kept = fieldsOf({
      title,
      description,
      labels,
      start,
      deadline,
      priority,
      subtasks,
      order,
      done: true,
      repeat: null,
    })
    const fields = fieldsOf({
      ...patch,
      done: false,
      start: next.start,
      deadline: next.deadline,
      repeat: next.repeat,
      subtasks: was.subtasks.map((one) => ({ ...one, done: false })),
    })
    await records.change([
      { id: copy, fields: { ...kept, kind: KIND, created: now, doneAt: now, gone: false } },
      { id: was.id, fields },
    ])
    this.moved = [
      ...this.moved.filter((one) => one.id !== was.id),
      { id: was.id, copy, was: { start, deadline, repeat: was.repeat, subtasks } },
    ]
    this.wrote()
    const moved = this.todo(was.id)
    return moved ? ok(moved) : missing(`no todo ${was.id}`)
  }
  private async moveBack(id: string, back: Moved): Promise<Result<Todo>> {
    const records = this.records
    if (!records) return missing('the todos are not open yet')
    await records.change([
      { id, fields: fieldsOf(back.was) },
      { id: back.copy, fields: { gone: true } },
    ])
    this.moved = this.moved.filter((one) => one.id !== id)
    this.wrote()
    const now = this.todo(id)
    return now ? ok(now) : missing(`no todo ${id}`)
  }
  async remove(id: string): Promise<Result<void>> {
    const records = this.records
    if (!records) return missing('the todos are not open yet')
    if (!this.todo(id)) return missing(`no todo ${id}`)
    await records.change([{ id, fields: { gone: true } }])
    this.wrote()
    return ok(undefined)
  }
  async restore(id: string): Promise<Result<Todo>> {
    const records = this.records
    if (!records) return missing('the todos are not open yet')
    if (records.fieldsOf(id)?.gone !== true) return missing(`no deleted todo ${id}`)
    await records.change([{ id, fields: { gone: false } }])
    this.wrote()
    const back = this.todo(id)
    return back ? ok(back) : missing(`no todo ${id}`)
  }
  async arrange(board: Board): Promise<Result<Board>> {
    const records = this.records
    if (!records) return missing('the todos are not open yet')
    await records.change([{ id: BOARD_ID, fields: boardFields(board) }])
    this.wrote()
    return ok(this.board)
  }
  exchange(): Promise<boolean> {
    if (this.exchanging) {
      this.again = true
      return this.exchanging
    }
    this.exchanging = this.exchanged().finally(() => {
      this.exchanging = null
      if (this.again) {
        this.again = false
        void this.exchange()
      }
    })
    return this.exchanging
  }
  private async exchanged(): Promise<boolean> {
    const server = this.server
    const records = this.records
    if (!server || !records || this.openedFor !== this.owner) return false
    try {
      const before = this.todos
      const answered = await records.exchange(server)
      if (records === this.records) {
        this.answers = answered
        if (this.todos !== before) this.channel?.postMessage('changed')
      }
      return answered
    } catch (error) {
      this.world.warn(`the todos did not reach the account: ${String(error)}`)
      return false
    }
  }
}
