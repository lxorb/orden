import type { Minute } from './minutes'
import { time } from './time.svelte'

const AGAIN = 60_000

export function watchedMinutes(range: () => readonly [number, number]): { list: Minute[] } {
  let list = $state.raw<Minute[]>([])
  $effect(() => {
    const [from, to] = range()
    let gone = false
    const load = () =>
      void time.minutes(from, to).then((found) => {
        if (!gone) list = found
      })
    load()
    const timer = setInterval(load, AGAIN)
    return () => {
      gone = true
      clearInterval(timer)
    }
  })
  return {
    get list() {
      return list
    },
  }
}

export function ticking(): { now: number } {
  let now = $state(Date.now())
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), time.running.length ? 1000 : 20_000)
    return () => clearInterval(timer)
  })
  return {
    get now() {
      return now
    },
  }
}
