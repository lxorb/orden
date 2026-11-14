import type { AgentAnswer } from '../../automation/caller'
import { Channel } from '../../crate/src/api'
import { shells } from '../../terminal/src/api'
import { identifier } from '../../identifier'
import { invoke, platform } from '../../platform/src/api'
import { asked } from './asks'
import { type Call, count, done, maybe, need } from './call'
import { Refused } from './problem'
import { MOST_LINE, onTheList, osOf, plainOf, startsOnlyOne, Tail } from './shell-text'
import { judged, onDisk, placeOf } from './spaces'
import { stopRefused, stopSignal } from './stopping'

const WAIT = 60_000
const MOST_WAIT = 600_000

const MOST_OUTPUT = 100_000
const KEPT = MOST_OUTPUT * 4

export async function runTerminal(call: Call): Promise<AgentAnswer> {
  const agent = call.caller.agent
  if (agent === null) throw new Refused('by_hand', 'the command line does not reach a shell')

  const command = need(call, 'command')
  if (/[\r\n]/.test(command)) throw new Refused('bad_arguments', 'one command line at a time')
  if (command.length > MOST_LINE) {
    throw new Refused('bad_arguments', `a command line is at most ${MOST_LINE} characters`)
  }

  if (maybe(call, 'tab') !== null) {
    const { runInTab } = await import('./terminal-tab')
    return runInTab(call)
  }

  const place = placeOf(call)
  const cwd = maybe(call, 'cwd')
  const folder = cwd === null ? place.space.root : onDisk(place, judged(cwd))

  await shells.ask()
  const shell = shells.chosen
  if (!shell) throw new Refused('unsupported_on_this_engine', 'there is no shell on this machine')

  const allowed = startsOnlyOne(command) && onTheList(command, agent.programs, osOf(platform()))
  const question = await asked(call, allowed ? null : 'terminal', command)
  if (question) return question

  const patience = count(call, 'timeout_ms', WAIT, MOST_WAIT)
  const halting = await stopSignal(call)
  const ran = await session(shell.id, folder, command, patience, halting.signal).finally(
    halting.end,
  )
  if (halting.signal.aborted) throw stopRefused(`${command} was ended`)
  const output = plainOf(ran.printed)
  const cut = ran.dropped || output.length > MOST_OUTPUT

  return done(
    {
      command,
      exit: ran.exit,
      output: cut ? output.slice(-MOST_OUTPUT) : output,
      ...(cut ? { truncated: true } : {}),
      ...(ran.exit === null ? { timed_out: true } : {}),
    },
    'terminal output',
  )
}

function session(
  shell: string,
  folder: string,
  command: string,
  patience: number,
  signal: AbortSignal,
): Promise<{ printed: string; dropped: boolean; exit: number | null }> {
  const id = `agent-${identifier().replace(/[^\w-]/g, '')}`.slice(0, 80)
  const decoder = new TextDecoder()
  const printed = new Tail(KEPT)
  const ended = (exit: number | null) => {
    printed.push(decoder.decode())
    return { printed: printed.text, dropped: printed.dropped, exit }
  }

  return new Promise((settle, fail) => {
    let over: ReturnType<typeof setTimeout> | undefined
    const halt = () => {
      clearTimeout(over)
      void invoke('pty_kill', { id }).catch(() => undefined)
      settle(ended(null))
    }
    signal.addEventListener('abort', halt, { once: true })

    const output = new Channel<unknown>()
    output.onmessage = (message) => {
      if (message instanceof ArrayBuffer) {
        const bytes = new Uint8Array(message)
        printed.push(decoder.decode(bytes, { stream: true }))
        void invoke('pty_seen', { id, bytes: bytes.length }).catch(() => undefined)
        return
      }

      const exit = (message as { exit?: unknown } | null)?.exit
      if (typeof exit === 'number') {
        clearTimeout(over)
        signal.removeEventListener('abort', halt)
        settle(ended(exit))
      }
    }

    invoke('pty_spawn', { id, shell, folder, cols: 160, rows: 48, output })
      .then(async () => {
        if (signal.aborted) {
          halt()
          return
        }
        over = setTimeout(halt, patience)

        await invoke('pty_write', { id, data: `${command}\r`, binary: false })
        await invoke('pty_write', { id, data: 'exit\r', binary: false })
      })
      .catch((error: unknown) => {
        clearTimeout(over)
        signal.removeEventListener('abort', halt)
        fail(new Refused('failed', `the shell would not start: ${String(error)}`))
      })
  })
}
