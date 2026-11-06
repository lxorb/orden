import type { AgentAnswer } from '../../automation/caller'
import { Channel } from '../../native'
import { shells } from '../../terminal/shells.svelte'
import { identifier } from '../../identifier'
import { invoke, platform } from '../../tauri'
import { asked } from './asks'
import { type Call, count, done, maybe, need } from './call'
import { Refused } from './problem'
import { onTheList, osOf, plainOf, startsOnlyOne } from './shell-text'
import { judged, onDisk, placeOf } from './spaces'

const WAIT = 60_000
const MOST_WAIT = 600_000

const MOST_OUTPUT = 100_000

export async function runTerminal(call: Call): Promise<AgentAnswer> {
  const agent = call.caller.agent
  if (agent === null) throw new Refused('by_hand', 'the command line does not reach a shell')

  const command = need(call, 'command')
  if (/[\r\n]/.test(command)) throw new Refused('bad_arguments', 'one command line at a time')

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

  const ran = await session(shell.id, folder, command, count(call, 'timeout_ms', WAIT, MOST_WAIT))
  const output = plainOf(ran.printed)
  const cut = output.length > MOST_OUTPUT

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
): Promise<{ printed: string; exit: number | null }> {
  const id = `agent-${identifier().replace(/[^\w-]/g, '')}`.slice(0, 80)
  const decoder = new TextDecoder()
  let printed = ''

  return new Promise((settle, fail) => {
    let over: ReturnType<typeof setTimeout> | undefined

    const output = new Channel<unknown>()
    output.onmessage = (message) => {
      if (message instanceof ArrayBuffer) {
        const bytes = new Uint8Array(message)
        printed += decoder.decode(bytes, { stream: true })
        void invoke('pty_seen', { id, bytes: bytes.length }).catch(() => undefined)
        return
      }

      const exit = (message as { exit?: unknown } | null)?.exit
      if (typeof exit === 'number') {
        clearTimeout(over)
        settle({ printed: printed + decoder.decode(), exit })
      }
    }

    invoke('pty_spawn', { id, shell, folder, cols: 160, rows: 48, output })
      .then(async () => {
        over = setTimeout(() => {
          void invoke('pty_kill', { id }).catch(() => undefined)
          settle({ printed: printed + decoder.decode(), exit: null })
        }, patience)

        await invoke('pty_write', { id, data: `${command}\r`, binary: false })
        await invoke('pty_write', { id, data: 'exit\r', binary: false })
      })
      .catch((error: unknown) => {
        clearTimeout(over)
        fail(new Refused('failed', `the shell would not start: ${String(error)}`))
      })
  })
}
