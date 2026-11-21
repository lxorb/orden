import { whileShown } from '../../panes/src/api'
import type { Minute } from './minutes'
import { time } from './time.svelte'

const AGAIN = 60_000
export function watchedMinutes(range: () => readonly [number, number]): { list: Minute[] } {
  let list = $state.raw<Minute[]>([])
  let asked = 0
  function load() {
    const [from, to] = range()
    const mine = ++asked
    void time.minutes(from, to).then((found) => {
      if (mine === asked) list = found
    })
  }
  $effect(() => {
    range()
    load()
  })
  whileShown(AGAIN, load)
  return {
    get list() {
      return list
    },
  }
}
export function ticking(): { now: number } {
  let now = $state(Date.now())
  whileShown(
    () => (time.running.length ? 1000 : 20_000),
    () => (now = Date.now()),
  )
  return {
    get now() {
      return now
    },
  }
}
