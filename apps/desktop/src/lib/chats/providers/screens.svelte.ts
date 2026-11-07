import type { Prompt, Screen } from '@orden/chats/provider'

export class Cancelled extends Error {
  constructor() {
    super('cancelled')
  }
}

export interface Asking {
  readonly prompt: Prompt
  answer(value: string): void
  cancel(): void
}

export class Screens {
  waiting = $state.raw<readonly Asking[]>([])
  screen = $state.raw<Screen | null>(null)

  get asking(): Asking | null {
    return this.waiting[0] ?? null
  }

  readonly ask = (prompt: Prompt): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const done = () => {
        this.waiting = this.waiting.filter((one) => one !== asking)
      }
      const asking: Asking = {
        prompt,
        answer: (value) => {
          done()
          resolve(value)
        },
        cancel: () => {
          done()
          reject(new Cancelled())
        },
      }
      this.waiting = [...this.waiting, asking]
    })

  readonly show = (screen: Screen | null): void => {
    this.screen = screen
  }

  cancelAll(): void {
    for (const one of this.waiting) one.cancel()
    this.screen = null
  }
}

export const screens = new Screens()
