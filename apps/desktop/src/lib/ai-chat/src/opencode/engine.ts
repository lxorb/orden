import type { Draft, Engine, EngineEvent, ModelInfo, Part, Stop, Thread, Turn } from '../../../ai-providers/src/api'
import type { Asking, Event, Message, PermissionRequest, Preset, Providers } from '../../../opencode-client/src/api'
import { Feed } from '../../../opencode-client/src/api'
import { keepJson, stored } from '../../../platform/src/api'
import type { Setup } from '../chat/engine'
import { errorText, modelTurn, youTurn } from '../chat/transcript'

const SESSIONS = 'orden:opencode-sessions'
export interface Wiring {
  session(title?: string): Promise<{ id: string }>
  messages(id: string): Promise<Message[]>
  permissions(): Promise<PermissionRequest[]>
  prompt(id: string, text: string, how: Asking): Promise<void>
  abort(id: string): Promise<unknown>
  summarize(id: string, providerID: string, modelID: string): Promise<unknown>
  providers(): Promise<Providers>
  ready(preset: Preset): Promise<void>
  follow(on: (event: Event) => void): Promise<unknown>
}
export function presetOf(mode: Thread['mode']): Preset {
  return mode === 'auto' || mode === 'full' ? mode : 'approve'
}
export function modelOf(model: string): { providerID?: string; modelID?: string } {
  const at = model.indexOf('/')
  return at > 0 ? { providerID: model.slice(0, at), modelID: model.slice(at + 1) } : {}
}
function sessionsKept(): Record<string, string> {
  const kept = stored(SESSIONS)
  return typeof kept === 'object' && kept !== null ? (kept as Record<string, string>) : {}
}
const idleIn = (event: Event): boolean =>
  event.type === 'session.idle' || (event.type === 'session.status' && event.properties.status.type === 'idle')
export function createOpenCodeEngine(
  setup: Setup,
  wiring: Wiring,
  agentOf: (thread: Thread) => string = () => 'build',
): Engine {
  const feed = new Feed()
  const loaded = new Set<string>()
  const heard = new Map<string, Set<(event: Event) => void>>()
  const kept = sessionsKept()
  let following: Promise<unknown> | null = null
  function follow(): Promise<unknown> {
    following ??= wiring
      .follow((event) => {
        const session = feed.apply(event)
        if (session) for (const one of heard.get(session) ?? []) one(event)
      })
      .catch((error: unknown) => {
        following = null
        throw error
      })
    return following
  }
  async function sessionFor(thread: Thread): Promise<string> {
    const held = kept[thread.id]
    if (held) return held
    const made = await wiring.session(thread.title || undefined)
    kept[thread.id] = made.id
    keepJson(SESSIONS, kept)
    return made.id
  }
  async function loadOnce(session: string): Promise<void> {
    if (loaded.has(session)) return
    const [messages, asked] = await Promise.all([wiring.messages(session), wiring.permissions()])
    feed.load(session, messages, asked)
    loaded.add(session)
  }
  async function run(thread: Thread, message: Draft, on: (event: EngineEvent) => void, signal: AbortSignal) {
    const you = youTurn(thread, message)
    thread.turns.push(you)
    if (!thread.title) thread.title = message.text.trim().split('\n')[0]?.slice(0, 80) ?? ''
    on({ type: 'turn', turn: you })
    const mine = new Map<string, Turn>()
    const marks = new Map<Turn, string[]>()
    let last: Turn | null = null
    const begin = (id: string | null): Turn => {
      const made = modelTurn(thread)
      thread.turns.push(made)
      if (id) mine.set(id, made)
      marks.set(made, [])
      last = made
      on({ type: 'turn', turn: made })
      return made
    }
    const push = (turn: Turn, part: Part) => {
      turn.parts.push(part)
      on({ type: 'part', turn: turn.id, index: turn.parts.length - 1, part })
    }
    const finish = (stop: Stop, error?: string): Stop => {
      const turn = last ?? begin(null)
      if (stop === 'stopped') push(turn, { kind: 'notice', code: 'stopped', text: '' })
      if (stop === 'error') push(turn, { kind: 'notice', code: 'error', text: error ?? '' })
      on(error === undefined ? { type: 'done', stop } : { type: 'done', stop, error })
      return stop
    }
    let session: string
    let before: Set<string>
    try {
      await wiring.ready(presetOf(thread.mode))
      await follow()
      session = await sessionFor(thread)
      await loadOnce(session)
      before = new Set(feed.turns(session).map((one) => one.id))
    } catch (error) {
      return finish('error', errorText(error))
    }
    const sync = () => {
      for (const said of feed.turns(session)) {
        if (said.role !== 'model' || before.has(said.id)) continue
        const turn = mine.get(said.id) ?? begin(said.id)
        const seen = marks.get(turn) ?? []
        said.parts.forEach((part, index) => {
          const mark = JSON.stringify(part)
          if (seen[index] === mark) return
          seen[index] = mark
          turn.parts[index] = part
          on({ type: 'part', turn: turn.id, index, part })
        })
        if (said.provider && said.model) turn.model = `${said.provider}/${said.model}`
        if (said.usage) {
          const usage = { ...said.usage, window: thread.usage.window }
          turn.usage = usage
          thread.usage = usage
          on({ type: 'usage', usage })
        }
      }
    }
    let busy = false
    let settle: (end: { stop: Stop; error?: string }) => void = () => undefined
    const ended = new Promise<{ stop: Stop; error?: string }>((resolve) => (settle = resolve))
    const listener = (event: Event) => {
      sync()
      if (event.type === 'session.status') busy ||= event.properties.status.type !== 'idle'
      if (event.type === 'session.error') {
        const said = event.properties.error
        settle({ stop: 'error', error: said?.data?.message ?? said?.name ?? 'OpenCode failed' })
      } else if (idleIn(event) && (busy || mine.size)) settle({ stop: signal.aborted ? 'stopped' : 'end' })
    }
    const listening = heard.get(session) ?? new Set()
    listening.add(listener)
    heard.set(session, listening)
    const stop = () => void wiring.abort(session).catch(() => undefined)
    signal.addEventListener('abort', stop, { once: true })
    try {
      const system = (await setup.instructions?.(thread).catch(() => '')) ?? ''
      await wiring.prompt(session, message.text, {
        agent: agentOf(thread),
        ...(system ? { system } : {}),
        ...modelOf(thread.model),
      })
      const end = await ended
      sync()
      return finish(end.stop, end.error)
    } catch (error) {
      return finish('error', errorText(error))
    } finally {
      listening.delete(listener)
      signal.removeEventListener('abort', stop)
      thread.updated = Date.now()
    }
  }
  return {
    async models() {
      const given = await wiring.providers()
      return given.all
        .filter((one) => given.connected.includes(one.id))
        .flatMap((provider) =>
          Object.values(provider.models).map((model): ModelInfo => ({
            id: `${provider.id}/${model.id}`,
            name: model.name,
            window: model.limit.context || null,
            efforts: ['auto'],
            images: false,
            fast: false,
          })),
        )
    },
    async send(thread, message, on, signal) {
      await run(thread, message, on, signal)
    },
    steer() {
      return Promise.resolve(false)
    },
    async compact(thread) {
      const session = kept[thread.id]
      const { providerID, modelID } = modelOf(thread.model)
      if (session && providerID && modelID) await wiring.summarize(session, providerID, modelID)
    },
  }
}
