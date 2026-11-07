import { accentFor } from '../../accents'
import type { TabAct } from '../../agent-marks.svelte'
import { theme } from '../../theme.svelte'
import { pages } from '../../web-tab/pages.svelte'
import { workspace } from '../../workspace.svelte'
import type { NoteDoc } from '../../workspace/documents.svelte'
import type { AgentEvent, Approval, Grant, Picture } from '../verbs'
import { touchedBy } from '../docs/touched'
import { keepInNote } from './keep'
import { callsOf, sessionMarkdown, today, type Call } from './session'
import { heard, isStopped, nothing, overviewed, type Seen, wrote } from './seen'
import type { Source } from './source'

export const MOST_LOG_LINES = 5_000

export class Activity {
  seen = $state<Seen>(nothing())

  now = $state(Date.now())

  lines = $state.raw<readonly unknown[]>([])

  holds = $state(false)

  constructor(readonly source: Source) {}

  private meanwhile: AgentEvent[] | null = null

  async load(): Promise<void> {
    this.meanwhile = []
    try {
      const [overview, holds] = await Promise.all([this.source.state(), this.source.holds()])
      overviewed(this.seen, overview, Date.now())
      for (const event of this.meanwhile) heard(this.seen, event, Date.now())
      this.holds = holds
      this.now = Date.now()
    } finally {
      this.meanwhile = null
    }
  }

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never drawn
  private answering = new Set<string>()

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never drawn
  private shown = new Set<string>()

  hear(event: AgentEvent): void {
    const now = Date.now()
    this.meanwhile?.push(event)
    heard(this.seen, event, now)
    const said = event.kind === 'answered' ? event.approval : null
    if (
      said?.answer === 'allowed' &&
      said.category === 'showing' &&
      said.tab &&
      this.holds &&
      !this.answering.has(said.id)
    ) {
      void this.show(said.tab, false)
    }
    this.now = now

    if (event.kind === 'connected' && event.agents.some((one) => !this.grantOf(one))) {
      void this.source
        .state()
        .then((overview) => (this.seen.agents = overview.agents))
        .catch(() => undefined)
    }
  }

  wrote(note: NoteDoc, agent: string): void {
    const now = Date.now()
    wrote(
      this.seen,
      agent,
      workspace.tabs.filter((tab) => tab.note === note).map((tab) => tab.id),
      now,
    )
    this.now = now
  }

  private logDay = ''
  private logTo = 0
  private logging: Promise<void> = Promise.resolve()

  readLog(): Promise<void> {
    this.logging = this.logging.catch(() => undefined).then(() => this.readMore())
    return this.logging
  }

  private async readMore(): Promise<void> {
    const day = today()
    const same = day === this.logDay
    const read = await this.source.log(day, same ? this.logTo : 0)
    if (!same || read.fresh) this.lines = read.lines.slice(-MOST_LOG_LINES)
    else if (read.lines.length) this.lines = this.lines.concat(read.lines).slice(-MOST_LOG_LINES)
    this.logDay = day
    this.logTo = read.to
  }

  grantOf(agent: string): Grant | undefined {
    return this.seen.agents.find((one) => one.id === agent)
  }

  nameOf(agent: string): string {
    return this.grantOf(agent)?.name ?? agent
  }

  colourOf(agent: string): string {
    return accentFor(this.nameOf(agent), theme.current)
  }

  get listed(): string[] {
    const seen = this.seen
    const ids = [
      ...seen.connected,
      ...seen.approvals.flatMap((one) => (one.agent === '' ? [] : [one.agent])),
      ...Object.values(seen.tabs).map((one) => one.agent),
    ]
    return ids.filter((one, at) => ids.indexOf(one) === at)
  }

  callsOf(agent: string): Call[] {
    return callsOf(this.lines, agent)
  }

  stopped(agent: string): boolean {
    return isStopped(this.seen, agent)
  }

  get questions(): Approval[] {
    return this.seen.approvals.filter((one) => one.category !== 'pairing')
  }

  async stop(agent?: string): Promise<void> {
    await this.source.stop(agent)
  }

  async resume(agent?: string): Promise<void> {
    await this.source.resume(agent)
  }

  async act(tab: string, what: TabAct): Promise<void> {
    const agent = this.seen.acting[tab]?.agent
    if (agent === undefined) return

    if (what === 'stop') await this.source.stop(agent)
    else if (agent in this.seen.halted) await this.source.resume(agent)
    else if (this.seen.stopped !== null) await this.source.resume()
  }

  async answer(approval: Approval, allow: boolean, always = false): Promise<void> {
    this.answering.add(approval.id)
    const answered = await this.source.answer(approval.id, allow, always)
    if (answered.answer === 'allowed' && answered.category === 'showing' && answered.tab) {
      await this.show(answered.tab, true)
    }
  }

  async show(agentTab: string, front = true): Promise<void> {
    const held = this.seen.tabs[agentTab]
    if (!held || this.shown.has(agentTab)) return
    this.shown.add(agentTab)
    try {
      const id = workspace.openPage(
        held.url,
        front ? 'front' : 'behind',
        workspace.activeTabId ?? undefined,
      )
      if (id === null) return

      const touch = this.seen.acting[agentTab]
      if (touch) this.seen.acting[id] = touch
      await pages.adopt(id, () => this.source.adopt(agentTab, id))
    } finally {
      this.shown.delete(agentTab)
    }
  }

  peek(agentTab: string): Promise<Picture> {
    return this.source.peek(agentTab)
  }

  goTo(tab: string): void {
    if (workspace.tabs.some((one) => one.id === tab)) workspace.activate(tab)
  }

  async addToNote(agent: string): Promise<void> {
    await this.readLog()
    await keepInNote(sessionMarkdown(this.nameOf(agent), this.callsOf(agent)))
  }

  undoable(agent: string): string | null {
    const path = workspace.active?.path ?? null
    return touchedBy(path).some((one) => one.id === agent) ? path : null
  }

  async undo(agent: string): Promise<void> {
    const path = this.undoable(agent)
    if (path === null) return

    const { undoAgentIn } = await import('../docs/index')
    await undoAgentIn({ id: agent, name: this.nameOf(agent) }, path)
  }
}
