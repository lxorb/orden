import { identifier } from '../../../identifier'
import { Channel } from '../../../crate/src/api'
import { invoke, isDesktop } from '../../../platform/src/api'
import type { Ask } from '../complete'
import { KIND_NAMES, type LocalKind } from '../providers'
import { claudeReader } from './claude'
import type { Heard } from './heard'
import { promptFor } from './prompt'
import { readerOf } from './readers'
import { heardIn, openSession, type Session } from './session'
import { plans } from './status.svelte'
import { type Ending, troubleOf } from './trouble'

export const PLANS: Record<LocalKind, string> = {
  'claude-code': 'Claude',
  codex: 'ChatGPT',
  'gemini-cli': 'Gemini',
}

function stopped(): DOMException {
  return new DOMException('The question was stopped.', 'AbortError')
}

class Listening {
  heard: Heard = {}
  answer = ''
  model = ''

  constructor(
    private readonly kind: LocalKind,
    private readonly ask: Ask,
    private readonly read: (line: string) => Heard,
  ) {}

  line(line: string): Heard['ended'] {
    const said = this.read(line)
    if (said.model) this.model = said.model
    if (said.limit) {
      this.heard.limit = said.limit
      plans.heard(this.ask.provider.id, said.limit)
    }
    if (said.trouble) this.heard.trouble = said.trouble
    if (said.signedOut) this.heard.signedOut = true
    if (said.text) {
      if (!this.answer) this.ask.named?.(this.model || this.ask.model || KIND_NAMES[this.kind])
      this.answer += said.text
      this.ask.stream?.(said.text)
    }
    return said.ended
  }

  finish(end: Ending): string {
    if (end.stopped || this.ask.signal?.aborted) throw stopped()
    if (this.heard.signedOut) plans.signedOut(this.ask.provider.id)
    const name = KIND_NAMES[this.kind]
    const trouble = troubleOf(name, PLANS[this.kind], this.heard, end, !!this.answer)
    if (trouble) throw new Error(trouble)
    return this.answer
  }
}

function startError(error: unknown, kind: LocalKind): Error {
  const said = error instanceof Error ? error.message : String(error)
  if (said === 'missing')
    return new Error(`${KIND_NAMES[kind]} is not installed.`, { cause: error })
  return new Error(said, { cause: error })
}

export async function askLocal(ask: Ask & { provider: { kind: LocalKind } }): Promise<string> {
  if (!isDesktop) throw new Error('Only in the desktop app.')
  if (ask.signal?.aborted) throw stopped()
  const { kind } = ask.provider
  return kind === 'claude-code' ? await askClaude(ask) : await askInSession(kind, ask)
}

async function askClaude(ask: Ask): Promise<string> {
  const listening = new Listening('claude-code', ask, claudeReader())
  const id = `ask-${identifier()}`
  const channel = new Channel<unknown>()
  const ended = new Promise<Ending>((resolve) => {
    channel.onmessage = (value) => {
      const said = heardIn(value)
      if (said?.kind === 'end') resolve(said.end)
      else if (said?.kind === 'line') listening.line(said.line)
    }
  })

  const stop = () => void invoke('ai_cli_stop', { id }).catch(() => undefined)
  ask.signal?.addEventListener('abort', stop, { once: true })
  try {
    try {
      await invoke('ai_cli_ask', {
        id,
        tool: 'claude-code',
        model: ask.model.trim() || null,
        account: ask.provider.id,
        prompt: promptFor(ask.messages),
        output: channel,
      })
    } catch (error) {
      throw startError(error, 'claude-code')
    }
    if (ask.signal?.aborted) stop()
    return listening.finish(await ended)
  } finally {
    ask.signal?.removeEventListener('abort', stop)
  }
}

async function askInSession(kind: Exclude<LocalKind, 'claude-code'>, ask: Ask): Promise<string> {
  const listening = new Listening(kind, ask, readerOf(kind))
  let done: (end: Ending) => void = () => undefined
  const ended = new Promise<Ending>((resolve) => (done = resolve))
  let session: Session
  try {
    session = await openSession(
      {
        tool: kind,
        agent: { id: ask.provider.id, name: ask.provider.name },
        mode: null,
        model: ask.model.trim() || null,
        effort: null,
      },
      (said) => {
        if (said.kind === 'end') done(said.end)
        else if (said.kind === 'reply' && said.error) {
          listening.heard.trouble = said.error
          done({ code: null, timedOut: false, stopped: false, err: said.error })
        } else if (said.kind === 'line') {
          const how = listening.line(said.line)
          if (how)
            done({
              code: how === 'error' ? 1 : 0,
              timedOut: false,
              stopped: how === 'stopped',
              err: '',
            })
        }
      },
    )
  } catch (error) {
    throw startError(error, kind)
  }

  const stop = () => void session.say({ kind: 'interrupt' }).catch(() => undefined)
  ask.signal?.addEventListener('abort', stop, { once: true })
  try {
    await session.say({ kind: 'turn', text: promptFor(ask.messages), images: [] })
    if (ask.signal?.aborted) stop()
    return listening.finish(await ended)
  } finally {
    ask.signal?.removeEventListener('abort', stop)
    void session.close()
  }
}
