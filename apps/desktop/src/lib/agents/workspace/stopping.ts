import type { Call } from './call'
import { Refused } from './problem'

let stops = 0
const halts = new Map<string, number>()
let hearing: Promise<unknown> | null = null

function heedStops(): Promise<unknown> {
  hearing ??= import('../settings/crate')
    .then(({ tauriCrate }) =>
      tauriCrate.hear((heard) => {
        if (heard.kind === 'stopped') stops += 1
        else if (heard.kind === 'paused' && heard.agent !== null) {
          halts.set(heard.agent, (halts.get(heard.agent) ?? 0) + 1)
        }
      }),
    )
    .catch(() => undefined)
  return hearing
}

export async function stopWatch(call: Call): Promise<(done: string) => void> {
  const agent = call.caller.agent?.id
  if (agent === undefined) return () => undefined
  await heedStops()
  const stopped = stops
  const halted = halts.get(agent) ?? 0
  return (done) => {
    if (stops !== stopped || (halts.get(agent) ?? 0) !== halted) {
      throw new Refused('stopped', `the reader pressed the stop: ${done}`)
    }
  }
}
