import { invoke, isDesktop } from '../tauri'
import { hub } from '../sync2/hub.svelte'
import { Activity, listenForInput, readSystemInput } from '../web-tab/activity'
import { keepZone } from './mine'

let made: Activity | null = null

export function deviceActivity(): Activity {
  if (made) return made
  made = new Activity({
    now: () => Date.now(),
    system: async () => (isDesktop ? readSystemInput(await invoke<unknown>('input_idle')) : null),
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
