import { type MachineState, near } from '@orden/online'
import { type Online, online, refusedOf, type Refused, startStop } from './calls'

class OnlineMachine {
  known = $state<Online | null>(null)
  refused = $state<Refused | null>(null)
  busy = $state(false)

  get near(): boolean {
    return this.known !== null && near(this.known.used, this.known.limit)
  }

  async refresh(): Promise<void> {
    try {
      this.known = await online()
      this.refused = null
    } catch (error) {
      this.refused = refusedOf(error)
    }
  }

  heard(state: MachineState) {
    const machine = this.known?.machine
    if (machine && machine.state !== state) machine.state = state
  }

  async startStop(start: boolean): Promise<void> {
    this.busy = true
    try {
      await startStop(start)
      this.refused = null
    } catch (error) {
      this.refused = refusedOf(error)
    } finally {
      this.busy = false
    }
    await this.refresh()
  }
}

export const machine = new OnlineMachine()
