import { inTurn } from '../locks'
import { notify } from '../notify'
import { keepJson, stored } from '../stored'
import { counted } from './counted'
import { lasting, MINUTE } from './days'
import { timeOn } from '../settings.svelte'
import { dueOf } from './goals'
import { time } from './time.svelte'

const TOLD = 'orden:time-told'

const KEPT = 100

function toldNow(): Set<string> {
  const held = stored(TOLD)
  return new Set(
    (Array.isArray(held) ? (held as unknown[]) : []).filter(
      (one): one is string => typeof one === 'string',
    ),
  )
}

function look(): void {
  if (!time.ready || !time.reminding || !timeOn()) return
  const told = toldNow()
  const due = dueOf(time.goals, counted(time.spans, time.rules), Date.now(), told)
  for (const one of due) {
    told.add(one.key)
    const name = time.activity(one.activity)?.name ?? 'No activity'
    notify(
      name,
      one.kind === 'goal' ? 'Goal reached' : `The timer has run for ${lasting(one.ms)}`,
      `time-${one.key}`,
    )
  }
  if (due.length) keepJson(TOLD, [...told].slice(-KEPT))
}

export function remind(): Promise<void> {
  return inTurn(
    () => TOLD,
    () => {
      look()
      return Promise.resolve()
    },
    MINUTE,
  )
}

setInterval(() => void remind(), MINUTE)
