/** Dictation into the panel's field, as `/voice` and "+ > Dictate" press it: the same
 *  microphone the composer's own button is (dictation/DictateButton.svelte), for the
 *  composer in the place used last (host.ts) - which is the one that says so here as
 *  it draws. What dictation is and where a voice goes is dictation/voice.svelte.ts. */

import { type Dictates, voice } from '../../dictation/voice.svelte'

class Dictation {
  /** The field of the composer in use, while one is drawn. */
  field: Dictates | null = null

  /** On, off, or the other of the two. */
  async toggle(on?: boolean): Promise<void> {
    const owner = this.field
    if (!owner) return
    const listening = voice.of(owner) !== 'idle'
    const want = on ?? !listening
    if (want && !listening) await voice.start(owner)
    else if (!want && listening) await voice.finish()
  }
}

export const dictation = new Dictation()
