import { isDesktop } from '../../tauri'
import type { AgentsCrate } from './crate'

class Reach {
  standIn = $state.raw<AgentsCrate | null>(null)

  get offered(): boolean {
    return isDesktop || this.standIn !== null
  }
}

export const reach = new Reach()
