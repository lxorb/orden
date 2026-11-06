import { type Dictates, voice } from '../../dictation/voice.svelte'

class Dictation {
  field: Dictates | null = null

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
