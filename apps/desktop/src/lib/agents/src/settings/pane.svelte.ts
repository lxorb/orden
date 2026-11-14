import { SvelteMap } from 'svelte/reactivity'
import { message } from '../../../ui-kit/src/api'
import type { Grant, Minted } from '../verbs'
import type { AgentsCrate, Heard } from './crate'
import { type Call, readCall } from '../ui/session'
import { lastActive } from './sessions'

export class AgentsPane {
  grants = $state<Grant[]>([])
  ready = $state(false)
  error = $state<string | null>(null)
  program = $state<string | null>(null)
  calls = $state.raw<Call[]>([])
  readonly last = new SvelteMap<string, number>()
  earlier = $state(false)
  minted = $state<Minted | null>(null)

  private unread: string[] = []
  private writing: Promise<unknown> = Promise.resolve()
  private pending = 0
  private stop: (() => void) | null = null
  private closed = false

  constructor(private readonly crate: AgentsCrate) {}

  async open(): Promise<void> {
    try {
      const [grants, days, program] = await Promise.all([
        this.crate.read(),
        this.crate.days(),
        this.crate.program(),
      ])
      this.grants = grants
      this.program = program
      this.unread = days
      this.earlier = days.length > 0
      this.ready = true

      const stop = await this.crate.hear((heard) => {
        this.heard(heard)
      })
      if (this.closed) stop()
      else this.stop = stop

      while (this.earlier && this.grants.some((one) => !this.last.has(one.id))) {
        await this.readEarlier()
      }
    } catch (error) {
      this.error = message(error, 'that did not work')
    }
  }

  close(): void {
    this.closed = true
    this.stop?.()
    this.stop = null
  }

  async readEarlier(): Promise<void> {
    const day = this.unread.shift()
    this.earlier = this.unread.length > 0
    if (day === undefined) return

    try {
      const read = (await this.crate.day(day)).flatMap((one, seq) => readCall(one, seq) ?? [])
      this.calls = [...read, ...this.calls]
      for (const [agent, at] of lastActive(read)) {
        if (at > (this.last.get(agent) ?? 0)) this.last.set(agent, at)
      }
    } catch (error) {
      this.error = message(error, 'that did not work')
    }
  }

  private heard(heard: Heard): void {
    if (heard.kind === 'acting' && heard.agent !== null) {
      this.last.set(heard.agent, Date.now())
    }
    if (heard.kind === 'answered' && this.pending === 0) void this.reload()
  }

  private async reload(): Promise<void> {
    try {
      this.grants = await this.crate.read()
    } catch (error) {
      this.error = message(error, 'that did not work')
    }
  }

  change(id: string, edit: (grant: Grant) => Grant): Promise<void> {
    this.error = null
    this.grants = this.grants.map((one) => (one.id === id ? edit(one) : one))
    return this.write((grants) => grants.map((one) => (one.id === id ? edit(one) : one)))
  }

  remove(id: string): Promise<void> {
    this.error = null
    this.grants = this.grants.filter((one) => one.id !== id)
    return this.write((grants) => grants.filter((one) => one.id !== id))
  }

  private write(change: (grants: Grant[]) => Grant[]): Promise<void> {
    this.pending += 1
    const done = this.writing.then(async () => {
      try {
        const written = await this.crate.write(change(await this.crate.read()))
        if (this.pending === 1) this.grants = written
      } catch (error) {
        this.error = message(error, 'that did not work')
        await this.reload()
      } finally {
        this.pending -= 1
      }
    })
    this.writing = done
    return done
  }

  async mint(name: string): Promise<void> {
    this.error = null
    try {
      const minted = await this.crate.mint(name)
      this.minted = minted
      this.grants = [...this.grants.filter((one) => one.id !== minted.grant.id), minted.grant]
    } catch (error) {
      this.error = message(error, 'that did not work')
    }
  }

  async clearLog(id: string): Promise<void> {
    this.error = null
    try {
      await this.crate.clear(id)
      this.calls = this.calls.filter((one) => one.agent !== id)
      this.last.delete(id)
    } catch (error) {
      this.error = message(error, 'that did not work')
    }
  }
}
