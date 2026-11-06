import { keepJson, stored } from '../stored'

const KEY = 'nib:browser-import-offer'

export const OFFER_DAYS = 3

export interface OfferKept {
  days: string[]
  done: boolean
}

export function keptOffer(said: unknown): OfferKept {
  if (typeof said !== 'object' || said === null) return { days: [], done: false }
  const { days, done } = said as Partial<Record<keyof OfferKept, unknown>>
  return {
    days: Array.isArray(days) ? days.filter((one): one is string => typeof one === 'string') : [],
    done: done === true,
  }
}

export function offerDue(kept: OfferKept, today: string): boolean {
  if (kept.done) return false
  return kept.days.includes(today) || kept.days.length < OFFER_DAYS
}

export function dayOf(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${at.getFullYear()}-${month}-${day}`
}

class ImportOffer {
  tab = $state<string | null>(null)

  private claimed = false

  claim(tab: string, today = dayOf(new Date())) {
    if (this.claimed || !offerDue(keptOffer(stored(KEY)), today)) return
    this.claimed = true
    this.tab = tab
  }

  seen(today = dayOf(new Date())) {
    const kept = keptOffer(stored(KEY))
    if (!kept.days.includes(today)) keepJson(KEY, { ...kept, days: [...kept.days, today] })
  }

  answered() {
    this.tab = null
    this.claimed = true
    keepJson(KEY, { ...keptOffer(stored(KEY)), done: true })
  }

  dropped(tab: string) {
    if (this.tab === tab) this.tab = null
  }
}

export const importOffer = new ImportOffer()
