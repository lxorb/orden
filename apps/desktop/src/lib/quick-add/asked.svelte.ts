import { keep, storedText } from '../platform/src/api'
import type { Prefill } from './entry'

const SMART = 'orden:quick-add-smart'
const ANYWHERE = 'orden:quick-add-anywhere'

class QuickAddAsk {
  open = $state(false)
  prefill = $state<Prefill>({})

  smart = $state(storedText(SMART) !== 'off')
  anywhere = $state(storedText(ANYWHERE) !== 'off')
  held = $state(false)

  show(prefill: Prefill = {}) {
    this.prefill = prefill
    this.open = true
  }

  hide() {
    this.open = false
  }

  setSmart(on: boolean) {
    this.smart = on
    keep(SMART, on ? 'on' : 'off')
  }

  setAnywhere(on: boolean) {
    this.anywhere = on
    keep(ANYWHERE, on ? 'on' : 'off')
  }
}

export const quickAdd = new QuickAddAsk()
