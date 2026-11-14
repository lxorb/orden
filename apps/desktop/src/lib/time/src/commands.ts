import { time } from './time.svelte'

export function startTimer(): void {
  const latest = time.latest()[0]
  if (latest) time.start(latest.id)
  else void import('./open').then(({ openTime }) => openTime())
}

export function stopTimer(): void {
  time.stop()
}
