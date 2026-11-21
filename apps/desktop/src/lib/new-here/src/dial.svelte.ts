import { type Aim, RESTING } from './sun-keys'

export class Dial {
  hub = $state(RESTING.hub)
  open = $state<number | null>(RESTING.open)
  index = $state<number | null>(RESTING.index)
  get aim(): Aim {
    return { hub: this.hub, open: this.open, index: this.index }
  }
  set aim(next: Aim) {
    this.hub = next.hub
    this.open = next.open
    this.index = next.open === null ? null : next.index
  }
  picked(slot: number, index: number): boolean {
    return this.open === slot && this.index === index
  }
}
