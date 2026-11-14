import { account, api } from '../accounts/src/api'
import { modes } from '../modes.svelte'
import { glassesKey } from './key.svelte'
import { EFFORTS } from './models'

export const EFFORT_WORDS: readonly { value: (typeof EFFORTS)[number]; label: string }[] = [
  { value: 'none', label: 'No reasoning' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Very high' },
  { value: 'max', label: 'The most it can' },
]

export class Offered {
  models = $state<string[]>([])
  said = $state('')

  constructor() {
    if (glassesKey.set) void this.ask()
  }

  async take(given: string): Promise<void> {
    this.models = []

    const key = given.trim()
    if (!key) {
      this.said = ''
      return
    }

    this.said = 'Saving the key'
    const wrong = await glassesKey.put(key)
    if (wrong) {
      this.said = wrong
      return
    }

    await this.ask()
  }

  async remove(): Promise<void> {
    await glassesKey.remove()
    this.models = []
    this.said = ''
  }

  private async ask(): Promise<void> {
    const token = account.accountToken
    if (!token) return

    this.said = 'Asking OpenAI which models this key can use'

    let found: string[]
    try {
      found = (await api.askModels(token)).models
    } catch (error) {
      if (account.accountToken !== token) return
      this.said = error instanceof Error ? error.message : 'Could not reach OpenAI'
      return
    }

    if (account.accountToken !== token) return
    this.models = found
    if (!found.length) {
      this.said = 'That key cannot use any of the models Orden asks for.'
      return
    }

    this.said = ''
    if (!found.includes(modes.glassesModel)) modes.setGlassesModel(found[0] ?? '')
  }
}
