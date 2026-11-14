import { err, failure, ok, type Result } from '@orden/contracts'
import { type Kept, TodoRecords, type TodoDisk, type TodoServer } from './records'
import { nextOrder } from './query'
import { checkedPatch, fieldsOf, KIND, newId, type Todo, todoOf, type TodoPatch } from './todo'

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

export class TodoStore {
  todos = $state<readonly Todo[]>([])
  answers = $state<boolean | null>(null)
  openedFor = $state<string | null | undefined>(undefined)

  private records: TodoRecords | null = null
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
    const checked = checkedPatch(patch)
    if (!checked.ok) return checked
    const id = newId()
    const now = this.world.now()
    const fields = fieldsOf({
      description: '',
      labels: [],
      space: null,
      start: null,
      deadline: null,
      priority: 0,
      done: false,
      subtasks: [],
      order: nextOrder(this.todos),
      ...checked.value,
    })
    await records.change([{ id, fields: { ...fields, kind: KIND, created: now, doneAt: null } }])
    this.wrote()
    const made = this.todo(id)
    return made ? ok(made) : missing('the todo was not kept')
  }

  async update(id: string, patch: TodoPatch): Promise<Result<Todo>> {
    const records = this.records
    if (!records) return missing('the todos are not open yet')
    const was = this.todo(id)
    if (!was) return missing(`no todo ${id}`)
    const checked = checkedPatch(patch)
    if (!checked.ok) return checked
    const fields = fieldsOf(checked.value)
    if (checked.value.done !== undefined && checked.value.done !== was.done) {
      fields.doneAt = checked.value.done ? this.world.now() : null
    }
    if (!Object.keys(fields).length) return ok(was)
    await records.change([{ id, fields }])
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
