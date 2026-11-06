import { revealPanel } from '../focus'
import './start.svelte'
import { time } from './time.svelte'

export function startTimer(): void {
  const latest = time.latest()[0]
  if (latest) time.start(latest.id)
  else revealPanel('time')
}

export function stopTimer(): void {
  time.stop()
}
