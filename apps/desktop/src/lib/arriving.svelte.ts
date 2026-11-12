import { SvelteSet } from 'svelte/reactivity'
import { afterQuiet } from './timing'

const STUCK = 6000

class Arriving {
  done = $state(0)
  total = $state<number | null>(null)
  showing = $state(false)
  stuck = $state(false)

  private readonly onTheWay = new SvelteSet<string>()

  private readonly stalling = afterQuiet(() => (this.stuck = true), STUCK)

  readonly said = $derived(
    this.total === null || this.total === 0
      ? 'Syncing'
      : `${Math.min(this.done, this.total)} of ${this.total}`,
  )

  get coming(): ReadonlySet<string> {
    return this.onTheWay
  }

  begin() {
    this.done = 0
    this.total = null
    this.stuck = false
    this.showing = true
    this.onTheWay.clear()
    this.wait()
  }

  listing(paths: readonly string[]) {
    for (const path of paths) this.onTheWay.add(path)
  }

  prune(has: (path: string) => boolean) {
    for (const path of [...this.onTheWay]) {
      if (has(path)) this.onTheWay.delete(path)
    }
  }

  expect(notes: number) {
    if (!this.showing) return

    this.total = notes
    if (notes === 0) this.finish()
  }

  arrived() {
    if (!this.showing) return

    this.done += 1
    this.stuck = false
    this.wait()
  }

  settled() {
    if (!this.showing) return

    this.finish()
  }

  giveUp() {
    this.finish()
  }

  reset() {
    this.finish()
    this.done = 0
    this.total = null
    this.onTheWay.clear()
  }

  private finish() {
    this.showing = false
    this.stuck = false
    this.stalling.cancel()
  }

  private wait() {
    this.stalling()
  }
}

export const arriving = new Arriving()
