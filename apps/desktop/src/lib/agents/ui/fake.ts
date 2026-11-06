import type {
  AgentEvent,
  AgentTab,
  Approval,
  Category,
  Grant,
  Overview,
  ShellWords,
} from '../verbs'
import type { Source } from './source'

function grantFor(id: string, name: string): Grant {
  return {
    id,
    name,
    client: name,
    scopes: [
      'context',
      'notes.read',
      'notes.write',
      'tree',
      'workspace',
      'browser',
      'browser.reader',
    ],
    spaces: 'all',
    sites: {},
    scripts: [],
    mode: 'unsupervised',
    asks: {},
    always: {},
    programs: [],
    limits: { tabs: 4, calls: 600, navigations: 60, memory: 0 },
    created: 0,
  }
}

export class FakeCrate implements Source {
  readonly overview: Overview = {
    agents: [],
    tabs: [],
    approvals: [],
    stopped: false,
    halted: [],
    connected: [],
  }

  readonly asked: { command: string; args: unknown[] }[] = []

  readonly lines: Record<string, unknown>[] = []

  told: { key: string | null; words: ShellWords } | null = null

  holding = true
  hidden = false

  private hearing: ((event: AgentEvent) => void) | null = null
  private next = 1

  listen(hear: (event: AgentEvent) => void): void {
    this.hearing = hear
  }

  emit(event: AgentEvent): void {
    this.hearing?.(event)
  }

  connect(id: string, name: string): Grant {
    const grant = this.overview.agents.find((one) => one.id === id) ?? grantFor(id, name)
    if (!this.overview.agents.includes(grant)) this.overview.agents.push(grant)
    if (!this.overview.connected.includes(id)) this.overview.connected.push(id)
    this.emit({ kind: 'connected', agents: [...this.overview.connected] })
    return grant
  }

  open(agent: string, url: string, title = ''): AgentTab {
    const tab: AgentTab = {
      id: `a${String(this.next++)}`,
      url,
      title,
      loading: false,
      store: 'reader',
      parked: false,
    }
    this.overview.tabs.push([agent, tab])
    this.emit({ kind: 'tab', agent, id: tab.id, url, title })
    return tab
  }

  act(agent: string, tab: string, verb: string, args: Record<string, unknown> = {}): void {
    this.lines.push({ at: Date.now(), agent, verb, tab, args, status: 'ok', ms: 20 })
    this.emit({ kind: 'acting', agent, tab, verb })
  }

  granted(agent: string, category: Category, summary: string, tab?: string): Approval {
    const approval: Approval = {
      id: `q${String(this.next++)}`,
      agent,
      name: this.overview.agents.find((one) => one.id === agent)?.name ?? agent,
      category,
      summary,
      verb: category === 'showing' ? 'browser_show' : 'browser_takeover',
      asked: Date.now(),
      answer: 'allowed',
      ...(tab === undefined ? {} : { tab }),
    }
    this.emit({ kind: 'answered', approval: { ...approval } })
    return approval
  }

  ask(agent: string, category: Category, summary: string, site?: string, tab?: string): Approval {
    const grant = this.overview.agents.find((one) => one.id === agent)
    const approval: Approval = {
      id: `q${String(this.next++)}`,
      agent,
      name: grant?.name ?? agent,
      category,
      summary,
      ...(site === undefined ? {} : { site }),
      ...(tab === undefined ? {} : { tab }),
      asked: Date.now(),
      answer: 'pending',
    }
    this.overview.approvals.push(approval)
    this.emit({ kind: 'asked', approval })
    return approval
  }

  pair(client: string): Approval {
    return this.ask('', 'pairing', client)
  }

  state(): Promise<Overview> {
    this.asked.push({ command: 'state', args: [] })
    return Promise.resolve(structuredClone(this.overview))
  }

  stop(agent?: string): Promise<boolean> {
    this.asked.push({ command: 'stop', args: [agent] })
    if (agent !== undefined) {
      if (!this.overview.halted.includes(agent)) this.overview.halted.push(agent)
      this.emit({ kind: 'paused', agent })
      return Promise.resolve(false)
    }

    const again = this.overview.stopped
    this.overview.stopped = true
    if (again) {
      for (const [agent, tab] of this.overview.tabs)
        this.emit({ kind: 'closed', agent, id: tab.id })
      this.overview.tabs = []
    }
    this.emit({ kind: 'stopped', closed: again })
    return Promise.resolve(again)
  }

  resume(agent?: string): Promise<void> {
    this.asked.push({ command: 'resume', args: [agent] })
    if (agent === undefined) {
      this.overview.stopped = false
      this.overview.halted = []
    } else {
      this.overview.halted = this.overview.halted.filter((one) => one !== agent)
    }
    this.emit({ kind: 'resumed', agent: agent ?? '' })
    return Promise.resolve()
  }

  answer(id: string, allow: boolean, always: boolean): Promise<Approval> {
    this.asked.push({ command: 'answer', args: [id, allow, always] })
    const approval = this.overview.approvals.find((one) => one.id === id)
    if (!approval) return Promise.reject(new Error('there is no such question'))

    approval.answer = allow ? (approval.category === 'takeover' ? 'done' : 'allowed') : 'denied'
    this.overview.approvals = this.overview.approvals.filter((one) => one.id !== id)
    this.emit({ kind: 'answered', approval: { ...approval } })
    return Promise.resolve({ ...approval })
  }

  log(day: string): Promise<unknown[]> {
    this.asked.push({ command: 'log', args: [day] })
    return Promise.resolve([...this.lines])
  }

  adopt(agentTab: string, tab: string): Promise<void> {
    this.asked.push({ command: 'adopt', args: [agentTab, tab] })
    const held = this.overview.tabs.find(([, one]) => one.id === agentTab)
    if (!held) return Promise.reject(new Error('there is no such agent tab'))

    this.overview.tabs = this.overview.tabs.filter(([, one]) => one.id !== agentTab)
    this.emit({ kind: 'closed', agent: held[0], id: agentTab })
    return Promise.resolve()
  }

  shell(key: string | null, words: ShellWords): Promise<void> {
    this.asked.push({ command: 'shell', args: [key] })
    this.told = { key, words }
    return Promise.resolve()
  }

  holds(): Promise<boolean> {
    return Promise.resolve(this.holding)
  }

  hide(): Promise<boolean> {
    this.asked.push({ command: 'hide', args: [] })
    this.hidden = this.holding && this.overview.connected.length > 0
    return Promise.resolve(this.hidden)
  }
}
