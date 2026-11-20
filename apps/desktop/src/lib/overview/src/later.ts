import { flushSync } from 'svelte'

const BUDGET = 4
const queue: (() => void)[] = []
let asked = false
function drain() {
  asked = false
  const until = performance.now() + BUDGET
  while (queue.length && performance.now() < until) {
    queue.shift()?.()
    flushSync()
  }
  if (queue.length) ask()
}
function ask() {
  if (asked) return
  asked = true
  requestAnimationFrame(() => setTimeout(drain, 0))
}
export function later(work: () => void) {
  queue.push(work)
  ask()
}
export function laterFirst(work: () => void) {
  queue.unshift(work)
  ask()
}
export function forgetLater() {
  queue.length = 0
}
