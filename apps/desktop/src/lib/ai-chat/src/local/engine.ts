import { userStep } from '../chat/transcript'
import type {
  Draft,
  Effort,
  Engine,
  EngineEvent,
  GoalState,
  Mode,
  ModelInfo,
  Part,
  Stop,
  Thread,
  Turn,
  Usage,
} from '../../../ai-providers/src/api'
import { always, type Answers, crateAnswers } from '../chat/approvals'
import {
  KIND_NAMES,
  type Heard,
  type Level,
  type LocalKind,
  type LocalRead as Read,
  localCli,
  type Message,
  type Provider,
  type Say,
  type Session,
} from '../../../ai-providers/src/api'
import { agentsOf } from '../review/changes'

const {
  GOAL_CLEARED,
  goalHeld,
  goalMessage,
  goalSaid,
  goesOn,
  listedModels,
  modelsIn,
  openSession,
  PLANS,
  plans,
  promptFor,
  QUIET,
  readerOf,
  startsItsOwnTurn,
  troubleOf,
} = await localCli()

export interface LocalSetup {
  provider(id: string): Provider | null
  answers?: Answers
  instructions?(thread: Thread): Promise<string>
}

const STOPPING = 10_000

interface Live {
  session: Session
  mode: Mode
  model: string
  effort: Effort
  fast: boolean
  account: string
  hear: ((said: Heard) => void) | null
  early: Heard[]
}

interface Running {
  thread: Thread
  on: (event: EngineEvent) => void
  pending: number
  steered: (text: string) => void
}

interface Pursuit {
  said: Say
  state: GoalState | null
  after: Say | null
}

function levelOf(kind: LocalKind, effort: Effort): Level | null {
  if (effort === 'auto' || kind === 'gemini-cli') return null
  if (kind === 'claude-code' && (effort === 'off' || effort === 'minimal')) return null
  return effort
}

function fresh(): string {
  return crypto.randomUUID()
}

function wordsOf(turn: Turn): string {
  return turn.parts
    .map((part) => (part.kind === 'text' ? part.text : ''))
    .join('')
    .trim()
}

function seeded(thread: Thread, instructions: string, message: string): string {
  const said: Message[] = []
  if (instructions) said.push({ role: 'system', content: instructions })
  for (const turn of thread.turns) {
    if (turn.role === 'you' && turn.draft)
      said.push({ role: 'user', content: userStep(turn.draft).text })
    else if (turn.role === 'model') {
      const words = wordsOf(turn)
      if (words) said.push({ role: 'assistant', content: words })
    }
  }
  said.push({ role: 'user', content: message })
  return promptFor(said)
}

export function createLocalEngine(kind: LocalKind, setup: LocalSetup): Engine {
  const sessions = new Map<string, Live>()
  const running = new Map<string, Running>()
  const answers = setup.answers ?? crateAnswers
  const windows = new Map<string, number>()
  let listed: ModelInfo[] = []

  function providerOf(thread: Thread): Provider {
    const provider = setup.provider(thread.provider)
    if (provider?.kind !== kind) throw new Error('That provider is not set up yet.')
    return provider
  }

  async function liveFor(thread: Thread, provider: Provider): Promise<[Live, boolean]> {
    const held = sessions.get(thread.id)
    const fits = held?.mode === thread.mode && held.account === provider.id
    if (held && !held.session.ended && fits) return [held, false]
    if (held) await held.session.close()

    let session: Session
    const early: Heard[] = []
    const box: { live?: Live } = {}
    try {
      session = await openSession(
        {
          tool: kind,
          agent: { id: provider.id, name: provider.name },
          mode: thread.mode,
          model: thread.model || null,
          effort: levelOf(kind, thread.effort),
          thread: thread.id,
          ...(thread.without?.length ? { without: thread.without } : {}),
        },
        (said) => {
          if (box.live?.hear) box.live.hear(said)
          else (box.live?.early ?? early).push(said)
        },
      )
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error)
      throw new Error(said === 'missing' ? `${KIND_NAMES[kind]} is not installed.` : said, {
        cause: error,
      })
    }
    const live: Live = {
      session,
      mode: thread.mode,
      model: thread.model,
      effort: thread.effort,
      fast: !!thread.fast,
      account: provider.id,
      hear: null,
      early,
    }
    box.live = live
    sessions.set(thread.id, live)
    return [live, true]
  }

  async function retell(live: Live, thread: Thread): Promise<void> {
    if (thread.model && thread.model !== live.model) {
      await live.session.say({ kind: 'model', model: thread.model })
      live.model = thread.model
    }
    if (thread.effort !== live.effort) {
      await live.session.say({ kind: 'effort', effort: levelOf(kind, thread.effort) })
      live.effort = thread.effort
    }
    if (kind === 'codex' && !!thread.fast !== live.fast) {
      await live.session.say({ kind: 'fast', on: !!thread.fast })
      live.fast = !!thread.fast
    }
  }

  async function run(
    thread: Thread,
    message: Draft,
    on: (event: EngineEvent) => void,
    signal: AbortSignal,
    pursuit: Pursuit | null = null,
  ): Promise<Stop> {
    const switched = [...thread.turns].reverse().find((one) => one.role === 'model')?.model
    const you: Turn = {
      id: fresh(),
      role: 'you',
      at: Date.now(),
      draft: message,
      parts: [],
      effort: thread.effort,
    }
    const before: Thread = { ...thread, turns: [...thread.turns] }
    thread.turns.push(you)
    if (!thread.title) thread.title = message.text.trim().split('\n')[0]?.slice(0, 80) ?? ''
    on({ type: 'turn', turn: you })

    let turn = modelTurn(thread)
    thread.turns.push(turn)
    on({ type: 'turn', turn })
    const say = (part: Part) => {
      turn.parts.push(part)
      on({ type: 'part', turn: turn.id, index: turn.parts.length - 1, part })
    }
    const grow = (index: number, part: Part) => {
      turn.parts[index] = part
      on({ type: 'part', turn: turn.id, index, part })
    }
    if (switched && thread.model && switched !== thread.model)
      say({ kind: 'notice', code: 'model', text: thread.model })

    let live: Live
    let opened: boolean
    let provider: Provider
    try {
      provider = providerOf(thread)
      ;[live, opened] = await liveFor(thread, provider)
      if (!opened) await retell(live, thread)
    } catch (error) {
      const words = error instanceof Error ? error.message : String(error)
      say({ kind: 'notice', code: 'error', text: words })
      on({ type: 'done', stop: 'error', error: words })
      return 'error'
    }

    const read: (line: string) => Read = readerOf(kind)
    const heard: Read = {}
    let answered = ''
    let named = false
    let thinkingAt = 0
    let stopping = false
    let between = false
    let quiet: ReturnType<typeof setTimeout> | undefined
    let closing: ((stop: Stop) => void) | null = null

    const finished = new Promise<{ stop: Stop; error?: string }>((resolve) => {
      const close = (stop: Stop, error?: string) => {
        clearTimeout(quiet)
        for (const part of turn.parts)
          if (part.kind === 'tool' && part.state === 'running') part.state = 'error'
        resolve(error === undefined ? { stop } : { stop, error })
      }
      closing = close

      const ended = (how: NonNullable<Read['ended']>) => {
        const flight = running.get(thread.id)
        if (how === 'end' && flight && flight.pending > 0) {
          flight.pending--
          turn = modelTurn(thread)
          thread.turns.push(turn)
          on({ type: 'turn', turn })
          return
        }
        if (stopping || how === 'stopped') {
          close('stopped')
          return
        }
        if (how === 'end' && pursuit?.after) {
          const after = pursuit.after
          pursuit.after = null
          between = true
          live.session.say(after).catch((error: unknown) => {
            heard.trouble = error instanceof Error ? error.message : String(error)
            ended('error')
          })
          return
        }
        if (how === 'end' && pursuit && goesOn(kind) && pursuit.state === 'pursuing') {
          between = true
          quiet = setTimeout(() => {
            close('end')
          }, QUIET)
          return
        }
        if (how === 'end') {
          close('end')
          return
        }
        const name = KIND_NAMES[kind]
        const words =
          troubleOf(
            name,
            PLANS[kind],
            heard,
            { code: 1, timedOut: false, stopped: false, err: '' },
            !!answered,
          ) ?? 'The model did not answer.'
        close('error', words)
      }

      const line = (text: string) => {
        const said = read(text)
        if (said.goal && pursuit) {
          pursuit.state = said.goal
          if (between && said.goal !== 'pursuing') {
            close('end')
            return
          }
        }
        if (between && (said.text || said.thinking || said.tool)) {
          between = false
          clearTimeout(quiet)
          if (turn.usage) spend(thread, turn.usage)
          turn = modelTurn(thread)
          thread.turns.push(turn)
          on({ type: 'turn', turn })
        }
        if (said.model && !named) {
          named = true
          on({ type: 'model', model: said.model })
        }
        if (said.limit) {
          const until =
            said.limit.until ?? (heard.limit?.state === 'reached' ? heard.limit.until : null)
          heard.limit = { ...said.limit, until }
          plans.heard(provider.id, heard.limit)
          on({ type: 'limit', limit: heard.limit })
        }
        if (said.trouble) heard.trouble = said.trouble
        if (said.signedOut) {
          heard.signedOut = true
          plans.signedOut(provider.id)
        }
        if (said.thinking) {
          const last = turn.parts.at(-1)
          if (last?.kind === 'thinking') {
            grow(turn.parts.length - 1, {
              ...last,
              text: last.text + said.thinking,
              ms: Date.now() - thinkingAt,
            })
          } else {
            thinkingAt = Date.now()
            say({ kind: 'thinking', text: said.thinking, ms: 0 })
          }
        }
        if (said.text) {
          answered += said.text
          const last = turn.parts.at(-1)
          if (last?.kind === 'text')
            grow(turn.parts.length - 1, { ...last, text: last.text + said.text })
          else say({ kind: 'text', text: said.text })
        }
        if (said.tool) {
          const tool = said.tool
          const at = turn.parts.findIndex((one) => one.kind === 'tool' && one.id === tool.id)
          const part = turn.parts[at]
          if (part?.kind === 'tool' && tool.done) {
            grow(at, {
              ...part,
              state: tool.done.error ? 'error' : 'ok',
              result: { text: tool.done.text, images: [], error: tool.done.error },
              at: Date.now(),
            })
          } else if (at < 0) {
            say({
              kind: 'tool',
              id: tool.id,
              verb: tool.name,
              args: tool.args ?? {},
              state: tool.done ? (tool.done.error ? 'error' : 'ok') : 'running',
              ...(tool.done
                ? {
                    result: { text: tool.done.text, images: [], error: tool.done.error },
                    at: Date.now(),
                  }
                : {}),
            })
          }
        }
        if (said.compacted) say({ kind: 'notice', code: 'compacted', text: '' })
        if (said.usage) counted(said.usage)
        if (said.ended) ended(said.ended)
      }

      const counted = (usage: NonNullable<Read['usage']>) => {
        if (usage.window) windows.set(thread.model, usage.window)
        const window =
          usage.window ??
          windows.get(thread.model) ??
          listed.find((one) => one.id === thread.model)?.window ??
          null
        const now: Usage = {
          input: usage.input ?? 0,
          cached: usage.cached ?? 0,
          output: usage.output ?? 0,
          reasoning: usage.reasoning ?? 0,
          window,
        }
        thread.usage = now
        turn.usage = now
        on({ type: 'usage', usage: now })
      }

      const hear = (said: Heard) => {
        if (said.kind === 'line') line(said.line)
        else if (said.kind === 'reply' && said.error && said.to !== 'model') {
          heard.trouble = said.error
          ended('error')
        } else if (said.kind === 'end') {
          if (stopping || said.end.stopped) {
            close('stopped')
            return
          }
          const words =
            troubleOf(KIND_NAMES[kind], PLANS[kind], heard, said.end, !!answered) ??
            'The model did not answer.'
          close('error', words)
        }
      }
      live.hear = hear
      const early = live.early.splice(0)
      if (opened) for (const said of early) hear(said)
    })

    const steered = (text: string) => {
      const said: Turn = {
        id: fresh(),
        role: 'you',
        at: Date.now(),
        draft: { text, attachments: [] },
        steered: true,
        parts: [],
        effort: thread.effort,
      }
      thread.turns.push(said)
      on({ type: 'turn', turn: said })
      if (kind === 'codex') {
        turn = modelTurn(thread)
        thread.turns.push(turn)
        on({ type: 'turn', turn })
      }
    }
    running.set(thread.id, { thread, on, pending: 0, steered })

    const agents = agentsOf(provider.id)
    const unhear = await answers
      .asked((asked) => {
        if (!agents.includes(asked.agent)) return
        const at = turn.parts.findIndex(
          (one) => one.kind === 'tool' && one.state === 'running' && one.verb === asked.verb,
        )
        const part = turn.parts[at]
        if (part?.kind !== 'tool') return
        if (always(thread, asked.verb, asked.category, asked.site)) {
          void answers.answer(asked.id, true)
          return
        }
        grow(at, {
          ...part,
          state: 'asking',
          result: {
            text: '',
            images: [],
            error: false,
            approval: asked.id,
            category: asked.category,
            ...(asked.site ? { site: asked.site } : {}),
          },
        })
      })
      .catch(() => () => undefined)

    const stop = () => {
      stopping = true
      if (pursuit) void live.session.say(goalHeld(kind)).catch(() => undefined)
      if (between) {
        closing?.('stopped')
        return
      }
      void live.session.say({ kind: 'interrupt' }).catch(() => undefined)
      setTimeout(() => {
        if (running.get(thread.id)?.thread === thread) void live.session.close()
      }, STOPPING)
    }
    signal.addEventListener('abort', stop, { once: true })

    try {
      const instructions = opened
        ? ((await setup.instructions?.(thread).catch(() => '')) ?? '')
        : ''
      const step = userStep(message)
      const seeding = opened && !!(instructions || before.turns.length)
      const text = seeding ? seeded(before, instructions, step.text) : step.text
      const turnSaid: Say = { kind: 'turn', text, images: step.images }
      if (!pursuit) await live.session.say(turnSaid)
      else if (!startsItsOwnTurn(kind)) {
        await live.session.say(pursuit.said)
        await live.session.say(turnSaid)
      } else if (seeding) {
        pursuit.after = pursuit.said
        await live.session.say(turnSaid)
      } else await live.session.say(pursuit.said)
      if (signal.aborted) stop()
      const end = await finished
      if (end.stop === 'stopped') say({ kind: 'notice', code: 'stopped', text: '' })
      else if (end.stop === 'error') say({ kind: 'notice', code: 'error', text: end.error ?? '' })
      if (turn.usage) spend(thread, turn.usage)
      on(
        end.error === undefined
          ? { type: 'done', stop: end.stop }
          : { type: 'done', stop: end.stop, error: end.error },
      )
      return end.stop
    } catch (error) {
      const words = error instanceof Error ? error.message : String(error)
      say({ kind: 'notice', code: 'error', text: words })
      on({ type: 'done', stop: 'error', error: words })
      return 'error'
    } finally {
      unhear()
      for (const part of turn.parts)
        if (part.kind === 'tool' && part.state === 'asking' && part.result?.approval) {
          void answers.answer(part.result.approval, false)
          part.state = 'error'
        }
      signal.removeEventListener('abort', stop)
      running.delete(thread.id)
      live.hear = null
      thread.updated = Date.now()
    }
  }

  return {
    async models(provider) {
      if (provider.kind !== kind) return []
      listed =
        kind === 'gemini-cli'
          ? modelsIn(kind, null)
          : modelsIn(kind, await listedModels(kind, provider.id))
      return listed.map((one) => ({ ...one, window: one.window ?? windows.get(one.id) ?? null }))
    },
    async send(thread, message, on, signal) {
      await run(thread, message, on, signal)
    },
    async goal(thread, to, on, signal) {
      if (to.do === 'pause' || to.do === 'clear') {
        const live = sessions.get(thread.id)
        if (live && !live.session.ended)
          await live.session.say(to.do === 'pause' ? goalHeld(kind) : GOAL_CLEARED)
        return to.do === 'pause' ? 'paused' : 'cleared'
      }
      const pursuit: Pursuit = { said: goalSaid(kind, to), state: 'pursuing', after: null }
      const stop = await run(
        thread,
        { text: goalMessage(kind, to), attachments: [] },
        on,
        signal,
        pursuit,
      )
      if (stop === 'stopped') return 'paused'
      if (stop !== 'end') return null
      return goesOn(kind) ? pursuit.state : null
    },
    async steer(thread, text) {
      const flight = running.get(thread.id)
      const live = sessions.get(thread.id)
      if (!flight || !live || live.session.ended || kind === 'gemini-cli') return false
      if (kind === 'codex') {
        await live.session.say({ kind: 'steer', text })
      } else {
        flight.pending++
        await live.session.say({ kind: 'turn', text, images: [] })
      }
      flight.steered(text)
      return true
    },
    async compact(thread, focus) {
      const live = sessions.get(thread.id)
      if (!live || live.session.ended || running.has(thread.id)) return
      await new Promise<void>((resolve) => {
        const read: (line: string) => Read = readerOf(kind)
        const timer = setTimeout(() => {
          done()
        }, 120_000)
        const done = () => {
          clearTimeout(timer)
          live.hear = null
          resolve()
        }
        live.hear = (said) => {
          const over =
            said.kind === 'end' ||
            (said.kind === 'reply' && said.to === 'compact') ||
            (said.kind === 'line' && finished(read(said.line)))
          if (over) done()
        }
        live.session.say({ kind: 'compact', focus: focus ?? '' }).catch(done)
      })
    },
    rewound(thread) {
      const live = sessions.get(thread.id)
      if (!live || running.has(thread.id)) return
      sessions.delete(thread.id)
      void live.session.close()
    },
  }
}

function finished(heard: Read): boolean {
  return !!heard.compacted || !!heard.ended
}

function modelTurn(thread: Thread): Turn {
  return {
    id: fresh(),
    role: 'model',
    at: Date.now(),
    parts: [],
    provider: thread.provider,
    model: thread.model,
    effort: thread.effort,
  }
}

function spend(thread: Thread, usage: Usage): void {
  const before = thread.spent ?? { input: 0, output: 0 }
  thread.spent = {
    ...before,
    input: before.input + usage.input,
    output: before.output + usage.output,
  }
}
