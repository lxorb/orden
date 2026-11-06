import { afterQuiet } from './timing'

const TROUBLE_SHOWN = 5000

class Busy {
  private depth = $state(0)
  label = $state<string | null>(null)

  trouble = $state<string | null>(null)
  private readonly clearing = afterQuiet(() => (this.trouble = null), TROUBLE_SHOWN)

  get active(): boolean {
    return this.depth > 0
  }

  async run<T>(label: string, work: () => Promise<T>): Promise<T> {
    if (this.depth === 0) this.clear()
    this.depth += 1
    this.label = label

    try {
      return await work()
    } finally {
      this.depth -= 1
      if (this.depth === 0) this.label = null
    }
  }

  failed(reason: string) {
    this.trouble = reason
    this.clearing()
  }

  clear() {
    this.clearing.cancel()
    this.trouble = null
  }

  start(label: string, work: () => Promise<unknown>) {
    void this.run(label, work).catch((error: unknown) => {
      console.error(error)
      this.failed(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
}

export const busy = new Busy()
