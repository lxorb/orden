import { type AgentReaderPort, portOf } from '@orden/contracts'
import type { Call } from './call'
import { Refused } from './problem'

let stops = 0
const halts = new Map<string, number>()
const ends = new Map<string, number>()
const heeding = new Set<{ agent: string; thread: string | null; halt: () => void }>()
let hearing: Promise<unknown> | null = null
export function readerPort(): AgentReaderPort {
  const port = portOf('agents.reader')
  if (!port.ok) throw new Refused('failed', 'the agents are not running')
  return port.value
}
function heedStops(): Promise<unknown> {
  hearing ??= Promise.resolve()
    .then(() =>
      readerPort().hear((heard) => {
        if (heard.kind === 'stopped') {
          stops += 1
          for (const one of [...heeding]) one.halt()
        } else if (heard.kind === 'paused' && typeof heard.agent === 'string') {
          const agent = heard.agent
          halts.set(agent, (halts.get(agent) ?? 0) + 1)
          for (const one of [...heeding]) if (one.agent === agent) one.halt()
        } else if (heard.kind === 'ended' && typeof heard.thread === 'string') {
          const thread = heard.thread
          ends.set(thread, (ends.get(thread) ?? 0) + 1)
          for (const one of [...heeding]) if (one.thread === thread) one.halt()
        }
      }),
    )
    .catch(() => {
      hearing = null
    })
  return hearing
}
function threadOf(call: Call): string | null {
  const caller = call.caller
  return caller.agent === null ? null : (caller.thread ?? null)
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
  const thread = threadOf(call)
  const ended = thread === null ? 0 : (ends.get(thread) ?? 0)
  return (done) => {
    if (stops !== stopped || (halts.get(agent) ?? 0) !== halted) throw stopRefused(done)
    if (thread !== null && (ends.get(thread) ?? 0) !== ended) throw stopRefused(done)
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
  const one = { agent, thread: threadOf(call), halt: () => halting.abort() }
  heeding.add(one)
  return { signal: halting.signal, end: () => void heeding.delete(one) }
}
