import { hub } from './api'
import { Activity, listenForInput, readSystemInput } from './activity'
import { keepZone } from '../../accounts/src/api'
import { invoke, isDesktop } from './ports'

let made: Activity | null = null

export function deviceActivity(): Activity {
  if (made) return made
  made = new Activity({
    now: () => Date.now(),
    system: async () => (isDesktop() ? readSystemInput(await invoke<unknown>('input_idle')) : null),
    listen: listenForInput,
    every: (ms, tick) => {
      const timer = setInterval(tick, ms)
      return () => clearInterval(timer)
    },
  })
  made.start()
  return made
}

let started = false

export function startHere(): void {
  if (started) return
  started = true

  const activity = deviceActivity()
  const say = () => {
    if (hub.leads) hub.send({ t: activity.active ? 'active' : 'idle' })
  }
  activity.changed(say)
  hub.opened(() => {
    say()
    void keepZone().catch(() => undefined)
  })
}
