import type { AgentAnswer } from '../../automation/caller'
import { MOST_LINE, plainOf } from './shell-text'
import { historyOf } from '../../terminal/history'
import { isOnlineTab } from '../../online/path'
import { shellRunning } from '../../terminal/running'
import { readSpec } from '../../terminal/spec'
import type { Session } from '../../terminal/sessions.svelte'
import { platform } from '../../tauri'
import type { Tab } from '../../workspace.svelte'
import { asked } from './asks'
import { type Call, count, done, flag, maybe, need } from './call'
import { Refused } from './problem'
import { stopRefused, stopSignal } from './stopping'
import { namedTab } from './tab-target'
import { KEY_NAMES, keyBytes, linesFrom, linesOf, shellOs, typesFreely } from './terminal-keys'

const MOST_KEYS = 100

const LINES = 200
const MOST_LINES = 5000

const WAIT = 2000
const MOST_WAIT = 30_000
const QUIET = 300

const STARTING = 5000
const READY_QUIET = 1000
const PROMPT_WAIT = 20_000

const OFF_SCREEN =
  'position:fixed;left:-10000px;top:0;width:960px;height:540px;visibility:hidden;pointer-events:none'

const SOURCE = 'terminal output'

async function sessionFor(tab: Tab): Promise<Session> {
  const { sessionOf } = await import('../../terminal/sessions.svelte')
  return sessionOf(tab)
}

function running(tab: Tab): boolean {
  return shellRunning(tab.id)
}

const CONNECTING = 60_000

async function readyOf(session: Session, patience: number, signal?: AbortSignal): Promise<void> {
  const until = Date.now() + patience
  for (;;) {
    const blocked = session.agentBlocked()
    if (blocked === null || blocked.lasting || Date.now() >= until || signal?.aborted) return
    await new Promise((go) => setTimeout(go, 50))
  }
}

function refusedFor(tab: Tab, session: Session): Refused {
  const blocked = session.agentBlocked()
  const why = `${tab.shown}: ${blocked?.why ?? 'the shell would not start'}`
  if (session.online && blocked?.lasting) {
    return new Refused(session.agentHeld ? 'by_hand' : 'not_granted', why)
  }
  return new Refused('failed', why)
}

async function startingOf(tab: Tab, signal?: AbortSignal): Promise<void> {
  const until = Date.now() + STARTING
  while (!running(tab) && Date.now() < until && !signal?.aborted) {
    await new Promise((go) => setTimeout(go, 50))
  }
}

async function started(tab: Tab, signal: AbortSignal): Promise<Session> {
  const session = await sessionFor(tab)
  if (session.agentBlocked() === null) return session

  if (session.online) {
    if (session.ended) session.startAgain()
    else if (!session.host.isConnected) await startedOffScreen(session, signal)
  } else if (session.host.isConnected) session.term.input('\r', false)
  else await startedOffScreen(session, signal)

  await startingOf(tab, signal)
  await readyOf(session, session.online ? CONNECTING : 0, signal)
  if (signal.aborted) throw stopRefused(`${tab.shown}: typed nothing`)
  if (session.agentBlocked() !== null) throw refusedFor(tab, session)
  await atPrompt(session.term, signal)
  if (halted(signal)) throw stopRefused(`${tab.shown}: typed nothing`)
  return session
}

function halted(signal: AbortSignal): boolean {
  return signal.aborted
}

async function atPrompt(term: Session['term'], signal: AbortSignal): Promise<void> {
  const until = Date.now() + PROMPT_WAIT
  do await quiet(term, until - Date.now(), READY_QUIET, READY_QUIET, signal)
  while (!linesOf(term.buffer.active, 0, 1).text.trim() && Date.now() < until && !signal.aborted)
}

async function startedOffScreen(session: Session, signal?: AbortSignal): Promise<void> {
  const holder = document.createElement('div')
  holder.style.cssText = OFF_SCREEN
  holder.setAttribute('aria-hidden', 'true')
  document.body.append(holder)
  try {
    await session.attach(holder, false)
    await startingOf(session.tab, signal)
  } finally {
    if (session.host.parentElement === holder) session.detach()
    holder.remove()
  }
}

function about(tab: Tab) {
  return { tab: tab.id, title: tab.shown, running: running(tab) }
}

export async function readTerminal(call: Call): Promise<AgentAnswer> {
  const { tab } = namedTab(call, ['terminal'], 'a terminal')
  const most = count(call, 'lines', LINES, MOST_LINES)

  if (isOnlineTab(tab) && !running(tab)) {
    const halting = await stopSignal(call)
    try {
      const session = await sessionFor(tab)
      if (!session.host.isConnected) await startedOffScreen(session, halting.signal)
      await readyOf(session, CONNECTING, halting.signal)
      if (halted(halting.signal)) throw stopRefused(`${tab.shown}: read nothing`)
      return screenOf(tab, session, most)
    } finally {
      halting.end()
    }
  }

  if (!running(tab)) {
    const spec = readSpec(tab.doc)
    const kept = spec?.key ? await historyOf({ space: tab.note.home, key: spec.key }) : null
    const lines = kept ? plainOf(kept.text).replace(/\r/g, '').split('\n') : []
    const cut = lines.length > most
    return done(
      {
        ...about(tab),
        output: (cut ? lines.slice(-most) : lines).join('\n').trimEnd(),
        ...(cut ? { truncated: true } : {}),
        ...(kept ? { restored: kept.at } : {}),
      },
      SOURCE,
    )
  }

  return screenOf(tab, await sessionFor(tab), most)
}

function screenOf(tab: Tab, session: Session, most: number): AgentAnswer {
  const buffer = session.term.buffer.active
  const read = linesOf(buffer, 0, most)
  return done(
    {
      ...about(tab),
      output: read.text,
      ...(read.truncated ? { truncated: true } : {}),
      ...(buffer.type === 'alternate' ? { full_screen: true } : {}),
      ...(session.current ? {} : { last_screen: true }),
    },
    SOURCE,
  )
}

export async function terminalSelection(tab: Tab, longest: number) {
  if (!running(tab)) return { running: false }

  const { term } = await sessionFor(tab)
  const selected = term.getSelection()
  if (!selected) return { running: true }

  return {
    running: true,
    selected: selected.slice(0, longest),
    ...(selected.length > longest ? { truncated: true } : {}),
  }
}

export function typeTerminal(call: Call): Promise<AgentAnswer> {
  return typed(call, maybe(call, 'text') ?? '', count(call, 'wait_ms', WAIT, MOST_WAIT), QUIET)
}

const RUN_WAIT = 60_000
const MOST_RUN_WAIT = 120_000
const RUN_QUIET = 1500

export function runInTab(call: Call): Promise<AgentAnswer> {
  const wait = count(call, 'timeout_ms', RUN_WAIT, MOST_RUN_WAIT)
  return typed(
    { ...call, args: { ...call.args, enter: true } },
    need(call, 'command'),
    wait,
    RUN_QUIET,
  )
}

async function typed(
  call: Call,
  text: string,
  patience: number,
  rest: number,
): Promise<AgentAnswer> {
  const agent = call.caller.agent
  if (agent === null) throw new Refused('by_hand', 'the command line does not type into a shell')

  const { tab } = namedTab(call, ['terminal'], 'a terminal')
  if (/[\r\n]/.test(text)) throw new Refused('bad_arguments', 'one line at a time')
  if (text.length > MOST_LINE) {
    throw new Refused('bad_arguments', `a line is at most ${MOST_LINE} characters`)
  }

  const listed: unknown[] = Array.isArray(call.args.keys) ? call.args.keys : []
  if (listed.length > MOST_KEYS) {
    throw new Refused('bad_arguments', `keys is a list of up to ${MOST_KEYS} keys`)
  }
  const keys = listed.map(String)
  const enter = 'enter' in call.args ? flag(call, 'enter') : text !== '' || !keys.length
  if (!text && !enter && !keys.length) throw new Refused('bad_arguments', 'say the text or keys')

  const judged = keyBytes(keys, false)
  if ('unknown' in judged) {
    throw new Refused('bad_arguments', `${judged.unknown} is not a key: ${KEY_NAMES.join(', ')}`)
  }

  const free = typesFreely(text, enter, keys, agent.programs, shellOs(isOnlineTab(tab), platform()))
  const shown = [text, enter ? 'Enter' : '', ...keys].filter(Boolean).join(' + ')
  const question = await asked(call, free ? null : 'terminal', `${tab.shown}: ${shown}`)
  if (question) return question

  const halting = await stopSignal(call)
  try {
    const session = await started(tab, halting.signal)
    const { term } = session
    const since = linesFrom(term)

    const sent = keyBytes(keys, term.modes.applicationCursorKeysMode)
    const bytes = text + (enter ? '\r' : '') + ('bytes' in sent ? sent.bytes : '')
    if (halting.signal.aborted) throw stopRefused(`${tab.shown}: typed nothing`)
    if (session.agentTyped(bytes) !== null) throw refusedFor(tab, session)

    const interrupt = () => {
      if (enter) session.agentTyped('\x03')
    }
    halting.signal.addEventListener('abort', interrupt, { once: true })
    await quiet(term, patience, rest * 2, rest, halting.signal)
    if (halted(halting.signal)) {
      throw stopRefused(`${tab.shown}: ${shown}${enter ? ', then Ctrl+C' : ''}`)
    }
    const read = since(MOST_LINES)
    return done(
      {
        ...about(tab),
        typed: shown,
        output: read.text,
        ...(read.truncated ? { truncated: true } : {}),
      },
      SOURCE,
    )
  } finally {
    halting.end()
  }
}

function quiet(
  term: Session['term'],
  patience: number,
  first = QUIET * 2,
  rest = QUIET,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((settle) => {
    let still: ReturnType<typeof setTimeout> | undefined
    const over = setTimeout(finish, patience)
    signal?.addEventListener('abort', finish, { once: true })
    const printing = term.onWriteParsed(() => {
      clearTimeout(still)
      still = setTimeout(finish, rest)
    })
    still = setTimeout(finish, first)

    function finish() {
      clearTimeout(over)
      clearTimeout(still)
      printing.dispose()
      signal?.removeEventListener('abort', finish)
      settle()
    }
  })
}
