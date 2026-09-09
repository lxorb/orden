/** Which models the account's own key may choose.
 *
 *  A store rather than a constant because the list comes from the API: model names
 *  change every few months, and a list written into the settings pane would be a
 *  list of models that used to exist. So the pane asks, once, when a key arrives
 *  and when it is opened with one already set.
 *
 *  It also owns the one line of prose under the key field, because the three things
 *  that line can say - asking, a key the API refused, nothing to offer - are the
 *  three states of this fetch and nothing else knows them. */

import { key, t } from '../i18n.svelte'
import { modes } from '../modes.svelte'
import { EFFORTS, modelsFor } from './models'

/** How hard the model is asked to think, in the words a reader would use.
 *
 *  The values are the API's own; the words are ours, because "xhigh" is not a word
 *  and a settings pane is not a wire format. */
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
  /** The ids on offer, in family order. Empty until a key has answered. */
  models = $state<string[]>([])
  /** The one line under the field: what is happening, or what went wrong. Empty
   *  when there is nothing to say, and the pane then says what the key is for. */
  said = $state('')

  constructor() {
    // A pane opened with a key already set: ask at once, so the model select is
    // there rather than appearing a second later.
    if (modes.glassesKey) void this.ask(modes.glassesKey)
  }

  /** A key the reader typed or pasted. Kept first, then asked with. */
  take(key: string): void {
    modes.setGlassesKey(key)
    this.models = []
    if (!modes.glassesKey) {
      this.said = ''
      return
    }

    void this.ask(modes.glassesKey)
  }

  private async ask(key: string): Promise<void> {
    this.said = t('Asking OpenAI which models this key can use')

    let found: string[]
    try {
      found = await modelsFor(key)
    } catch (error) {
      // A phone with no signal, a whitelist that does not have the origin on it, a
      // key with a typo: all of them are "no models", and the reader needs the
      // reason rather than an empty select.
      this.said = error instanceof Error ? error.message : t('Could not reach OpenAI')
      return
    }

    this.models = found
    if (!found.length) {
      this.said = t('That key cannot use any of the models Nib asks for.')
      return
    }

    this.said = ''
    // Nothing chosen yet, or a model that is no longer offered: take the first,
    // which is the newest family. A select with nothing in it is a question the
    // reader cannot answer.
    if (!found.includes(modes.glassesModel)) modes.setGlassesModel(found[0] ?? '')
  }
}
