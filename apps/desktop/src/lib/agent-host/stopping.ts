import type { Call } from './call'
import { Refused } from './problem'

let stops = 0
const halts = new Map<string, number>()
const heeding = new Set<{ agent: string; halt: () => void }>()
let hearing: Promise<unknown> | null = null

function heedStops(): Promise<unknown> {
  hearing ??= import('../agents/src/api')
    .then(({ tauriCrate }) =>
      tauriCrate.hear((heard) => {
        if (heard.kind === 'stopped') {
          stops += 1
          for (const one of [...heeding]) one.halt()
        } else if (heard.kind === 'paused' && heard.agent !== null) {
          halts.set(heard.agent, (halts.get(heard.agent) ?? 0) + 1)
          for (const one of [...heeding]) if (one.agent === heard.agent) one.halt()
        }
      }),
    )
    .catch(() => undefined)
  return hearing
}

export function stopRefused(done: string): Refused {
  return new Refused('stopped', `the reader pressed the stop: ${done}`)
}

export async function stopWatch(call: Call): Promise<(done: string) => void> {
  const agent = call.caller.agent?.id
  if (agent === undefined) return () => undefined
  await heedStops()
  const stopped = stops
  const halted = halts.get(agent) ?? 0
  return (done) => {
    if (stops !== stopped || (halts.get(agent) ?? 0) !== halted) throw stopRefused(done)
  }
}

export interface Halting {
  signal: AbortSignal
  end: () => void
}

export async function stopSignal(call: Call): Promise<Halting> {
  const halting = new AbortController()
  const agent = call.caller.agent?.id
  if (agent === undefined) return { signal: halting.signal, end: () => undefined }
  await heedStops()
  const one = { agent, halt: () => halting.abort() }
  heeding.add(one)
  return { signal: halting.signal, end: () => void heeding.delete(one) }
}
