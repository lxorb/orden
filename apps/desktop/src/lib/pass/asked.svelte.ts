export type PassIntent = 'new-login' | 'generator'

class Asked {
  intent = $state<PassIntent | null>(null)

  take(): PassIntent | null {
    const intent = this.intent
    this.intent = null
    return intent
  }
}

export const asked = new Asked()
