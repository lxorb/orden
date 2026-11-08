import { isRecord, keepJson, stored } from '../stored'
import { exportSheet } from '../surfaces.svelte'

const KEPT = 'orden:export-choice'

export interface Kept {
  id: string
  optioned: Record<string, boolean>
}

function kept(): Kept {
  const held = stored(KEPT)
  if (!isRecord(held) || typeof held.id !== 'string') return { id: '', optioned: {} }
  const optioned = isRecord(held.optioned) ? held.optioned : {}
  return {
    id: held.id,
    optioned: Object.fromEntries(
      Object.entries(optioned).filter(
        (one): one is [string, boolean] => typeof one[1] === 'boolean',
      ),
    ),
  }
}

class Picker {
  open = $state(false)
  last = $state<Kept>(kept())

  show() {
    this.last = kept()
    this.open = true
    void exportSheet.ask()
  }

  close() {
    this.open = false
  }

  keep(id: string, optioned: boolean) {
    this.last = { id, optioned: { ...this.last.optioned, [id]: optioned } }
    keepJson(KEPT, this.last)
  }
}

export const picker = new Picker()
