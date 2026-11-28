export { default as Activities } from '../Activities.svelte'
export { default as Now } from './Now.svelte'
export { default as Day } from './Day.svelte'
export { default as Stats } from './Stats.svelte'
export { readSpec } from '../spec'
export { ticking } from '../watched.svelte'
export { undone } from '../edit'
export type { StatsRange } from './range'
export { default as BottomSheet } from './BottomSheet.svelte'
import { time } from '../time.svelte'
export { watchTrack } from './bridge.svelte'
export const reminders = {
  get on() {
    return time.reminding
  },
  set: (on: boolean) => time.remind(on),
}
export const refreshed = (): Promise<void> => time.exchange()
