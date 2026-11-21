import {
  type LocalKind,
  isLocal,
  onMoves,
  type Provider,
  type ProviderKind,
  type Api,
  type Draft,
  type Engine,
  type EngineEvent,
  type ModelInfo,
  type Part,
  type Stop,
  type Thread,
  type ToolOutput,
  type Turn,
  type Usage,
} from '../../../ai-providers/src/api'
import { anthropic } from './anthropic'
import { always, type Answers, crateAnswers } from './approvals'
import { catalogue, unlisted, windowIn } from './catalogue'
import { compactionOf, compactThread } from './compact'
import { completions } from './completions'
import { gemini } from './gemini'
import { within } from './effort'
import { learn, learnt } from './learned'
import { watching } from './sends'
import { Refused, wasStopped } from './request'
import { responses } from './responses'
import { type Adjusted, round } from './round'
import { crateTools, type Tools } from './tools'
import {
  answeredBy,
  baseEffort,
  type Call,
  continuedWith,
  errorText,
  modelTurn,
  stepsOf,
  type Step,
  youTurn,
} from './transcript'
import { added, estimate, noUsage, shouldCompact } from './usage'
import type { Ask, ToolDef, Wire } from './wire'
import { fitOutputs, limitOf, roomFor, tokensIn, windowOf } from './window'
import { allows } from './reach'

function apiOf(kind: ProviderKind): Api | null {
  if (kind === 'anthropic') return 'anthropic'
  if (kind === 'openai' || kind === 'chatgpt') return 'responses'
  if (kind === 'compatible') return 'completions'
  if (kind === 'gemini') return 'gemini'
  return null
}
const WIRES: Record<Api, Wire> = { anthropic, responses, completions, gemini }
export const MOST_ROUNDS = 40
const GO_ON = 'Go on with the request from where the summary leaves off.'
const MOST_ASKS = 3
let leaving = false
if (typeof addEventListener === 'function') {
  for (const name of ['beforeunload', 'pagehide']) addEventListener(name, () => (leaving = true))
  for (const name of ['pageshow', 'pointerdown', 'keydown'])
    addEventListener(name, () => (leaving = false), { capture: true, passive: true })
}
const CITE = 'Name the note or page each claim comes from as a [[wikilink]] or its address.'
const PARTLY = 'Change part of a note with edit_note rather than write_note: they may be typing in it.'
const MATHS =
  'Write maths as $…$ inline and $$…$$ on lines of their own, and a subscript or superscript outside maths as H~2~O and x^2^.'
const SYSTEM: Record<Thread['mode'], string> = {
  approve: [
    'You are the reader’s agent inside Orden, their notes app and web browser, in a panel beside what they are reading.',
    'Answer from what you read, and do what they ask with the tools you have; they approve each change before it is made.',
    CITE,
    PARTLY,
    'Reply in the language of the request, in markdown, briefly: no preamble, no sign-off.',
    MATHS,
  ].join(' '),
  plan: [
    'You are the reader’s assistant inside Orden, their notes app and web browser, in a panel beside what they are reading.',
    'You are in Plan mode: read what you need, then write the plan as one new note with create_note, a task (- [ ]) per step, and change nothing else.',
    CITE,
    'Reply in the language of the request, briefly.',
    MATHS,
  ].join(' '),
  auto: [
    'You are the reader’s agent inside Orden, their notes app and web browser, in a panel beside what they are reading.',
    'Do what they ask with the tools you have: most changes are made at once and shown to them to keep or undo, and a call that sends, deletes or publishes may wait for their approval.',
    CITE,
    PARTLY,
    'Reply in the language of the request, briefly, saying what you did.',
    MATHS,
  ].join(' '),
  full: [
    'You are the reader’s agent inside Orden, their notes app and web browser, in a panel beside what they are reading.',
    'Do what they ask with the tools you have, without asking first; every change you make is shown to them to keep or undo.',
    'Nothing is asked of them or handed back: sign in with what their password manager filled, and pay, send, delete or change a setting yourself where the task needs it, never browser_takeover.',
    CITE,
    PARTLY,
    'Reply in the language of the request, briefly, saying what you did.',
    MATHS,
  ].join(' '),
}
export interface Setup {
  provider(id: string): Provider | null
  tools?: Tools
  answers?: Answers
  instructions?(thread: Thread): Promise<string>
}
function lastModel(thread: Thread): string {
  const last = answeredBy(thread)
  return last ? `${last.provider}/${last.model}` : ''
}
function given<T extends { tools: ToolDef[] }>(thread: Thread, listing: T): T {
  return { ...listing, tools: listing.tools.filter((one) => allows(thread, one.name)) }
}
function failRunning(turn: Turn): void {
  for (const part of turn.parts) if (part.kind === 'tool' && part.state === 'running') part.state = 'error'
}
function keptOut(name: string): ToolOutput {
  return { text: `${name} is not available in this chat.`, images: [], error: true }
}
export function createApiEngine(setup: Setup): Engine {
  const tools = setup.tools ?? crateTools
  const answers = setup.answers ?? crateAnswers
  const listed = new Map<string, ModelInfo[]>()
  const steering = new Map<string, string[]>()
  let moves = 0
  onMoves((moved) => {
    moves++
    for (const one of moved) listed.delete(one.from)
  })
  function providerOf(thread: Thread): Provider {
    const provider = setup.provider(thread.provider)
    if (!provider || !apiOf(provider.kind)) throw new Error('That provider is not set up yet.')
    return provider
  }
  async function modelOf(provider: Provider, id: string): Promise<ModelInfo> {
    let models = listed.get(provider.id)
    if (!models) {
      const before = moves
      models = await catalogue(provider).catch(() => [])
      if (models.length && before === moves) listed.set(provider.id, models)
    }
    return models.find((one) => one.id === id) ?? unlisted(provider, id)
  }
  async function systemFor(thread: Thread, instructions: string): Promise<string> {
    const own = (await setup.instructions?.(thread).catch(() => '')) ?? ''
    return [SYSTEM[thread.mode], instructions, own].filter(Boolean).join('\n\n')
  }
  async function send(
    thread: Thread,
    message: Draft,
    on: (event: EngineEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    let provider: Provider
    let api: Api
    try {
      provider = providerOf(thread)
      api = apiOf(provider.kind) ?? 'completions'
    } catch (error) {
      on({ type: 'done', stop: 'error', error: errorText(error) })
      return
    }
    const wire = WIRES[api]
    let model = await modelOf(provider, thread.model)
    thread.effort = within(thread.effort, model.efforts)
    if (shouldCompact(thread.usage, estimate(message), thread.autocompact)) {
      await compact(thread).catch(() => undefined)
    }
    const switched = lastModel(thread)
    const context = allows(thread, 'get_context') ? await tools.context(provider, thread.id).catch(() => '') : ''
    const begin = (made: Turn) => {
      thread.turns.push(made)
      on({ type: 'turn', turn: made })
      return made
    }
    const you = youTurn(thread, message, context ? { context } : {})
    thread.turns.push(you)
    if (!thread.title) thread.title = message.text.trim().split('\n')[0]?.slice(0, 80) ?? ''
    on({ type: 'turn', turn: you })
    let turn = begin(modelTurn(thread))
    const say = (part: Part) => {
      turn.parts.push(part)
      on({ type: 'part', turn: turn.id, index: turn.parts.length - 1, part })
    }
    const moved = continuedWith({ ...thread, turns: thread.turns.slice(0, -2) }, provider.name)
    if (moved) say(moved)
    else if (switched && switched !== `${thread.provider}/${thread.model}`)
      say({ kind: 'notice', code: 'model', text: model.name })
    let listing = { instructions: '', tools: [] as ToolDef[] }
    if (learnt(provider.id, model.id).tools !== false) {
      listing = given(thread, await tools.list(provider, thread.mode).catch(() => listing))
    }
    const system = await systemFor(thread, listing.instructions)
    const perMessage = api === 'anthropic' && learnt(provider.id, model.id).perMessage !== false
    let steps: Step[] = stepsOf(
      {
        turns: thread.turns.slice(0, -1),
        ...(thread.compaction ? { compaction: thread.compaction } : {}),
      },
      api,
      model.id,
      perMessage,
    )
    let addedNow: unknown[] = []
    let used: Usage | null = null
    let answered = ''
    let stop: Stop = 'end'
    steering.set(thread.id, [])
    let start = turn.parts.length
    const adjusted = (change: Adjusted) => {
      if (change.effort) {
        thread.effort = change.effort
        turn.effort = change.effort
      }
      if (change.efforts) {
        const efforts = change.efforts
        model = { ...model, efforts }
        listed.set(
          provider.id,
          (listed.get(provider.id) ?? []).map((one) => (one.id === model.id ? { ...one, efforts } : one)),
        )
      }
      if (change.toolsRefused) {
        listing = { ...listing, tools: [] }
        say({ kind: 'notice', code: 'no_tools', text: '' })
        start = turn.parts.length
      }
    }
    const close = (whole: boolean) => {
      turn.model = model.id
      if (used) turn.usage = used
      if (whole && addedNow.length) turn.replay = { api, model: model.id, messages: addedNow }
    }
    const askNow = (): Ask => ({
      provider,
      model,
      effort: thread.effort,
      base: perMessage ? baseEffort(thread, thread.effort) : thread.effort,
      fast: !!thread.fast,
      system,
      tools: listing.tools,
      steps,
      added: addedNow,
      web: !!message.web,
      perMessage,
    })
    const window = () => windowOf(thread.usage.window, model.window)
    const fitted = async () => {
      if (tokensIn(wire.request(askNow()).body) <= limitOf(window(), thread.autocompact)) return
      const before = thread.turns.slice(0, -1)
      const upTo = before.at(-1)
      if (!upTo) return
      const compacted = await compactionOf(
        {
          thread,
          provider,
          api,
          wire,
          model,
          system,
          tools: listing.tools,
          steps: [...steps, ...(addedNow.length ? [{ role: 'native' as const, messages: addedNow }] : [])],
        },
        signal,
      ).catch((error: unknown) => {
        if (wasStopped(error) || signal.aborted) throw error
        return null
      })
      if (!compacted) return
      const { spent, ...made } = compacted
      thread.compaction = { ...made, upTo: upTo.id }
      if (spent) spend(thread, { ...noUsage(null), input: spent.input, output: spent.output })
      steps = [
        ...stepsOf({ turns: before, compaction: thread.compaction }, api, model.id, perMessage),
        { role: 'user', text: GO_ON, images: [] },
      ]
      addedNow = []
      say({ kind: 'notice', code: 'compacted', text: '' })
    }
    try {
      for (let rounds = 0; ; rounds++) {
        if (rounds >= MOST_ROUNDS) {
          say({ kind: 'notice', code: 'steps', text: String(MOST_ROUNDS) })
          stop = 'steps'
          break
        }
        await fitted()
        start = turn.parts.length
        const result = await round(
          wire,
          askNow(),
          (parts, changed, said) => {
            if (said && !answered) {
              answered = said
              on({ type: 'model', model: said })
            }
            for (const index of changed) {
              const part = parts[index]
              if (!part) continue
              const copy = { ...part }
              turn.parts[start + index] = copy
              on({ type: 'part', turn: turn.id, index: start + index, part: copy })
            }
          },
          adjusted,
          signal,
        )
        result.parts.forEach((part, index) => (turn.parts[start + index] = { ...part }))
        if (result.usage) {
          used = used ? added(used, result.usage) : result.usage
          thread.usage = { ...result.usage, window: result.usage.window ?? model.window }
          spend(thread, result.usage)
          on({ type: 'usage', usage: thread.usage })
        }
        addedNow = [...addedNow, ...result.answer.messages]
        const { ending, calls } = result.answer
        if (ending === 'end' && !turn.parts.some((part) => part.kind === 'text' || part.kind === 'tool')) {
          throw new Error('The model did not answer.')
        }
        if (ending === 'pause') continue
        if (ending === 'tool') {
          const ran = await runCalls(thread, provider, calls, turn, start, on, signal)
          const now = tokensIn(wire.request(askNow()).body)
          const outputs = fitOutputs(ran, roomFor(window(), limitOf(window(), thread.autocompact), now))
          addedNow = [...addedNow, ...wire.results(outputs)]
          if (signal.aborted) throw new DOMException('stopped', 'AbortError')
        } else if (ending !== 'end') {
          stop = ending
          failRunning(turn)
          say({ kind: 'notice', code: ending, text: result.answer.refusal ?? '' })
          break
        }
        const steered = steering.get(thread.id)?.splice(0) ?? []
        if (steered.length) {
          close(true)
          steps = [...steps, { role: 'native', messages: addedNow }]
          for (const text of steered) {
            const said = begin(youTurn(thread, { text, attachments: [] }, { steered: true }))
            steps = [...steps, ...stepsOf({ turns: [said] }, api, model.id)]
          }
          addedNow = []
          used = null
          turn = begin(modelTurn(thread))
          continue
        }
        if (ending === 'end') break
      }
      close(stop === 'end' || stop === 'steps')
      on({ type: 'done', stop })
    } catch (error) {
      close(false)
      failRunning(turn)
      if (wasStopped(error) || signal.aborted || leaving) {
        say({ kind: 'notice', code: 'stopped', text: '' })
        on({ type: 'done', stop: 'stopped' })
      } else {
        const words = errorText(error)
        if (error instanceof Refused) {
          const window = windowIn(words)
          if (window) learn(provider.id, model.id, { window })
        }
        say({ kind: 'notice', code: 'error', text: words })
        on({ type: 'done', stop: 'error', error: words })
      }
    } finally {
      steering.delete(thread.id)
      thread.updated = Date.now()
    }
  }
  async function runCalls(
    thread: Thread,
    provider: Provider,
    calls: readonly Call[],
    turn: Turn,
    from: number,
    on: (event: EngineEvent) => void,
    signal: AbortSignal,
  ): Promise<{ call: Call; output: ToolOutput }[]> {
    const written = (call: Call, output: ToolOutput) => {
      const index = turn.parts.findIndex((one, at) => at >= from && one.kind === 'tool' && one.id === call.id)
      const part = turn.parts[index]
      if (part?.kind !== 'tool') return
      const done: Part = {
        ...part,
        args: call.args,
        state: output.approval ? 'asking' : output.error ? 'error' : 'ok',
        result: output,
        at: Date.now(),
      }
      turn.parts[index] = done
      on({ type: 'part', turn: turn.id, index, part: done })
    }
    return await Promise.all(
      calls.map(async (call) => {
        const ask = (): Promise<ToolOutput> =>
          allows(thread, call.name)
            ? tools.call(provider, thread.mode, call.name, call.args, thread)
            : Promise.resolve(keptOut(call.name))
        let output = await ask()
        for (let asked = 0; output.approval && asked < MOST_ASKS; asked++) {
          const approval = output.approval
          if (always(thread, call.name, output.category, output.site)) await answers.answer(approval, true)
          else {
            written(call, output)
            if (!(await answers.answered(approval, signal))) {
              if (signal.aborted) await answers.answer(approval, false)
              output = { text: 'The reader said no.', images: [], error: true }
              break
            }
          }
          output = await ask()
        }
        written(call, output)
        return { call, output }
      }),
    )
  }
  async function compact(thread: Thread, focus?: string): Promise<void> {
    const provider = providerOf(thread)
    const api = apiOf(provider.kind) ?? 'completions'
    const model = await modelOf(provider, thread.model)
    const listing = given(
      thread,
      await tools.list(provider, thread.mode).catch(() => ({ instructions: '', tools: [] })),
    )
    const system = await systemFor(thread, listing.instructions)
    await compactThread({
      thread,
      provider,
      api,
      wire: WIRES[api],
      model,
      system,
      tools: listing.tools,
      focus,
    })
  }
  return {
    async models(provider) {
      const models = await catalogue(provider)
      listed.set(provider.id, models)
      return models
    },
    send,
    steer(thread, text) {
      const list = steering.get(thread.id)
      list?.push(text)
      return Promise.resolve(!!list)
    },
    compact,
  }
}
function spend(thread: Thread, usage: Usage): void {
  const before = thread.spent ?? { input: 0, output: 0 }
  const cost = (before.cost ?? 0) + (usage.cost ?? 0)
  thread.spent = {
    input: before.input + usage.input,
    output: before.output + usage.output,
    ...(before.cost !== undefined || usage.cost !== undefined ? { cost } : {}),
  }
}
const loadLocal = (kind: LocalKind) => async (setup: Setup) =>
  (await import('../local/engine')).createLocalEngine(kind, setup)
const localEngines: Partial<Record<LocalKind, (setup: Setup) => Promise<Engine>>> = {
  'claude-code': loadLocal('claude-code'),
  codex: loadLocal('codex'),
}
export function registerLocalEngine(kind: LocalKind, load: (setup: Setup) => Promise<Engine>): void {
  localEngines[kind] = load
  localBuilt.delete(kind)
}
const localBuilt = new Map<LocalKind, WeakMap<Setup, Engine>>()
const built = new WeakMap<Setup, Engine>()
export async function engineFor(kind: ProviderKind, setup: Setup): Promise<Engine> {
  if (isLocal(kind)) {
    const load = localEngines[kind]
    if (!load) throw new Error('That provider is not set up yet.')
    const mine = localBuilt.get(kind) ?? new WeakMap<Setup, Engine>()
    localBuilt.set(kind, mine)
    const kept = mine.get(setup)
    if (kept) return kept
    const engine = watching(await load(setup))
    mine.set(setup, engine)
    return engine
  }
  const held = built.get(setup)
  if (held) return held
  const engine = watching(createApiEngine(setup))
  built.set(setup, engine)
  return engine
}
