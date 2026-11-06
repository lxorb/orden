import { account } from '../account.svelte'
import { api } from '../api'
import { key, t } from '../i18n.svelte'
import { modes } from '../modes.svelte'
import { glassesKey } from './key.svelte'
import { EFFORTS } from './models'

export const EFFORT_WORDS: readonly { value: (typeof EFFORTS)[number]; label: string }[] = [
  { value: 'none', label: key('No reasoning') },
  { value: 'minimal', label: key('Minimal') },
  { value: 'low', label: key('Low') },
  { value: 'medium', label: key('Medium') },
  { value: 'high', label: key('High') },
  { value: 'xhigh', label: key('Very high') },
  { value: 'max', label: key('The most it can') },
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

    this.said = t('Saving the key')
    const wrong = await glassesKey.put(key)
    if (wrong) {
      this.said = t(wrong)
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

    this.said = t('Asking OpenAI which models this key can use')

    let found: string[]
    try {
      found = (await api.askModels(token)).models
    } catch (error) {
      this.said = error instanceof Error ? error.message : t('Could not reach OpenAI')
      return
    }

    this.models = found
    if (!found.length) {
      this.said = t('That key cannot use any of the models Orden asks for.')
      return
    }

    this.said = ''
    if (!found.includes(modes.glassesModel)) modes.setGlassesModel(found[0] ?? '')
  }
}
