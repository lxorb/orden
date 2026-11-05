/** The reader's own terminal tabs: `read_terminal` and `type_terminal`
 *  (docs/agent-native.md 8.9).
 *
 *  `run_terminal` is a shell nobody sees. These are the shells the reader has open, the
 *  dev server they started and the build they are watching, which is what "look at my
 *  terminal" and "restart the server" mean. VS Code's agent reads a terminal's output
 *  (`getTerminalOutput`, `terminalLastCommand`) and JetBrains' asks before every command
 *  it types; Orden does both.
 *
 *  - **Reading** is the reader's screen as words: the scrollback and the screen, wrapped
 *    lines joined, its colours gone, marked as the terminal's and never the reader's
 *    (9.6). A terminal not looked at since a restart has no shell yet, and answers the
 *    lines it came back with. `context`, which is seeing what the reader sees.
 *  - **Typing** runs commands in the reader's own shell, which is the whole machine, so
 *    it is `terminal` and asks the reader the way `run_terminal` does: one command line
 *    whose program is on the agent's list, with Enter, goes; anything else asks, and so
 *    does every key but an interrupt (terminal-keys.ts). A terminal whose shell has not
 *    started - made behind the tab in front, or put back by a restart and not looked at
 *    since - is started off screen, at a size of its own, and is fitted to its pane the
 *    first time it is shown. The answer is what the shell printed until it went quiet.
 *
 *  The screen is the session's (terminal/sessions.svelte.ts), fetched only once a tab is
 *  asked about: nothing of xterm.js is loaded for an agent that never names a terminal. */

import type { AgentAnswer } from '../../automation/caller'
import { plainOf } from './shell-text'
import { historyOf } from '../../terminal/history'
import { isOnlineTab } from '../../online/path'
import { shellRunning } from '../../terminal/running'
import { readSpec } from '../../terminal/spec'
import type { Session } from '../../terminal/sessions.svelte'
import type { Tab } from '../../workspace.svelte'
import { asked } from './asks'
import { type Call, count, done, flag, maybe, need } from './call'
import { Refused } from './problem'
import { namedTab } from './tab-target'
import { KEY_NAMES, keyBytes, linesOf, typesFreely } from './terminal-keys'

/** How many lines come back when the agent does not say, and at the most. */
const LINES = 200
const MOST_LINES = 5000

/** How long typing waits for the shell to go quiet, when the agent does not say, and at
 *  the most; and how long quiet is. */
const WAIT = 2000
const MOST_WAIT = 30_000
const QUIET = 300

/** How long a shell started off screen is given to start, and how long it has to be
 *  quiet after printing before it is taken to be at its prompt: a shell drops what is
 *  typed before it is ready to read it (PowerShell's line editor does), and a profile
 *  can pause between the banner and the prompt. */
const STARTING = 5000
const READY_QUIET = 1000
const PROMPT_WAIT = 20_000

/** Where a terminal is drawn while it starts with nobody looking: a box of a usual
 *  terminal's size, off every screen and invisible, so xterm.js can measure its cells. */
const OFF_SCREEN =
  'position:fixed;left:-10000px;top:0;width:960px;height:540px;visibility:hidden;pointer-events:none'

/** Where the words came from, for every answer here (9.6). */
const SOURCE = 'terminal output'

/** The tab's session, made the first time it is asked for. */
async function sessionFor(tab: Tab): Promise<Session> {
  const { sessionOf } = await import('../../terminal/sessions.svelte')
  return sessionOf(tab)
}

/** Whether the tab's shell is running now: its own, or an online terminal's session,
 *  live (#1125). */
function running(tab: Tab): boolean {
  return shellRunning(tab.id)
}

/** How long an online terminal is given to reach its machine, which may have to wake:
 *  inside the time `nib mcp` waits for an answer. */
const CONNECTING = 60_000

/** Until nothing stands between an agent and the shell, something that will not pass by
 *  waiting does, or `patience` is over. */
async function readyOf(session: Session, patience: number): Promise<void> {
  const until = Date.now() + patience
  for (;;) {
    const blocked = session.agentBlocked()
    if (blocked === null || blocked.lasting || Date.now() >= until) return
    await new Promise((go) => setTimeout(go, 50))
  }
}

/** The refusal for a terminal an agent may not type into now: held by another device
 *  is the reader's to take back, kept to its owner is not this agent's, and the rest is
 *  a shell that is not there. */
function refusedFor(tab: Tab, session: Session): Refused {
  const blocked = session.agentBlocked()
  const why = `${tab.shown}: ${blocked?.why ?? 'the shell would not start'}`
  if (session.online && blocked?.lasting) {
    return new Refused(session.agentHeld ? 'by_hand' : 'not_granted', why)
  }
  return new Refused('failed', why)
}

/** Until the tab's shell is running, or the time to start one is over. */
async function startingOf(tab: Tab): Promise<void> {
  const until = Date.now() + STARTING
  while (!running(tab) && Date.now() < until) await new Promise((go) => setTimeout(go, 50))
}

/** The tab's shell, started off screen if it has not been, and at its prompt. One on
 *  screen whose shell ended is started again the way the reader would, with Enter. */
async function started(tab: Tab): Promise<Session> {
  const session = await sessionFor(tab)
  if (session.agentBlocked() === null) return session

  // An online terminal is reached through its own socket, and never by a key of the
  // app's: Enter under its card is Take over or Try again, which are the reader's.
  if (session.online) {
    if (session.ended) session.startAgain()
    else if (!session.host.isConnected) await startedOffScreen(session)
  } else if (session.host.isConnected) session.term.input('\r', false)
  else await startedOffScreen(session)

  await startingOf(tab)
  await readyOf(session, session.online ? CONNECTING : 0)
  if (session.agentBlocked() !== null) throw refusedFor(tab, session)
  await atPrompt(session.term)
  return session
}

/** Until a shell just started has printed something - its prompt, after whatever its
 *  profile prints first - and gone quiet, or the wait is over. A profile that starts
 *  conda takes seconds before anything shows. */
async function atPrompt(term: Session['term']): Promise<void> {
  const until = Date.now() + PROMPT_WAIT
  do await quiet(term, until - Date.now(), READY_QUIET, READY_QUIET)
  while (!linesOf(term.buffer.active, 0, 1).text.trim() && Date.now() < until)
}

/** A shell nobody has drawn, started in a box off every screen. */
async function startedOffScreen(session: Session): Promise<void> {
  const holder = document.createElement('div')
  holder.style.cssText = OFF_SCREEN
  holder.setAttribute('aria-hidden', 'true')
  document.body.append(holder)
  try {
    await session.attach(holder, false)
    await startingOf(session.tab)
  } finally {
    // Out of the page again, still running: the pane takes the screen the first time
    // the tab is shown, which is what a terminal behind the tab in front always is.
    if (session.host.parentElement === holder) session.detach()
    holder.remove()
  }
}

/** What a terminal tab is, beside its words. */
function about(tab: Tab) {
  return { tab: tab.id, title: tab.shown, running: running(tab) }
}

export async function readTerminal(call: Call): Promise<AgentAnswer> {
  const { tab } = namedTab(call, ['terminal'], 'a terminal')
  const most = count(call, 'lines', LINES, MOST_LINES)

  if (isOnlineTab(tab) && !running(tab)) {
    // An online terminal is read through its own socket, as it is now (#1125), reached
    // the way its tab reaches it; where it cannot be - another device holds it - its
    // last screen, said to be that.
    const session = await sessionFor(tab)
    if (!session.host.isConnected) await startedOffScreen(session)
    await readyOf(session, CONNECTING)
    return screenOf(tab, session, most)
  }

  if (!running(tab)) {
    // Never drawn this run: the lines it came back with, if any were kept.
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

/** A terminal's screen as words, at most `most` lines of it. */
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

/** What is selected in a terminal tab, for `get_context`: only where it is running,
 *  since a screen nobody has drawn has nothing selected. */
export async function terminalSelection(tab: Tab) {
  if (!running(tab)) return { running: false }

  const { term } = await sessionFor(tab)
  const selected = term.getSelection()
  return { running: true, ...(selected ? { selected } : {}) }
}

export function typeTerminal(call: Call): Promise<AgentAnswer> {
  return typed(call, maybe(call, 'text') ?? '', count(call, 'wait_ms', WAIT, MOST_WAIT), QUIET)
}

/** How long `run_terminal` in a tab waits for a command when the agent does not say, and
 *  at the most; and how long the shell is quiet before the command is taken to be done. */
const RUN_WAIT = 60_000
const MOST_RUN_WAIT = 120_000
const RUN_QUIET = 1500

/** `run_terminal` with a `tab`: the command typed into one of the reader's terminals -
 *  a local one or an online one, alike (#1125) - with Enter, under the rules typing keeps,
 *  and what it printed until it went quiet. */
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

  const keys = Array.isArray(call.args.keys) ? call.args.keys.map(String) : []
  // Enter unless the agent says otherwise, or only presses keys.
  const enter = 'enter' in call.args ? flag(call, 'enter') : text !== '' || !keys.length
  if (!text && !enter && !keys.length) throw new Refused('bad_arguments', 'say the text or keys')

  // Judged before anything starts, so a key nobody knows refuses at once.
  const judged = keyBytes(keys, false)
  if ('unknown' in judged) {
    throw new Refused('bad_arguments', `${judged.unknown} is not a key: ${KEY_NAMES.join(', ')}`)
  }

  const free = typesFreely(text, enter, keys, agent.programs)
  const shown = [text, enter ? 'Enter' : '', ...keys].filter(Boolean).join(' + ')
  const question = await asked(call, free ? null : 'terminal', `${tab.shown}: ${shown}`)
  if (question) return question

  const session = await started(tab)
  const { term } = session
  const buffer = term.buffer.active
  const from = buffer.baseY + buffer.cursorY

  const sent = keyBytes(keys, term.modes.applicationCursorKeysMode)
  const bytes = text + (enter ? '\r' : '') + ('bytes' in sent ? sent.bytes : '')
  if (session.agentTyped(bytes) !== null) throw refusedFor(tab, session)

  await quiet(term, patience, rest * 2, rest)
  const read = linesOf(term.buffer.active, from, MOST_LINES)
  return done(
    {
      ...about(tab),
      typed: shown,
      output: read.text,
      ...(read.truncated ? { truncated: true } : {}),
    },
    SOURCE,
  )
}

/** Until the terminal has printed nothing for `rest` since it last printed - or for
 *  `first` where it prints nothing at all - or the wait is over. */
function quiet(
  term: Session['term'],
  patience: number,
  first = QUIET * 2,
  rest = QUIET,
): Promise<void> {
  return new Promise((settle) => {
    let still: ReturnType<typeof setTimeout> | undefined
    const over = setTimeout(finish, patience)
    const printing = term.onWriteParsed(() => {
      clearTimeout(still)
      still = setTimeout(finish, rest)
    })
    still = setTimeout(finish, first)

    function finish() {
      clearTimeout(over)
      clearTimeout(still)
      printing.dispose()
      settle()
    }
  })
}
