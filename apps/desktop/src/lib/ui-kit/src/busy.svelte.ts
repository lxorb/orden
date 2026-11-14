import { afterQuiet } from '../../platform/src/api'

const TROUBLE_SHOWN = 5000

class Busy {
  private depth = $state(0)
  label = $state<string | null>(null)

  told = $state<string | null>(null)

  trouble = $state<string | null>(null)
  private readonly clearing = afterQuiet(() => (this.trouble = null), TROUBLE_SHOWN)
  private shownFor: ReturnType<typeof setTimeout> | undefined
  private readonly underway = new Set<string>()

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
      if (this.depth === 0) {
        this.label = null
        this.told = null
      }
    }
  }

  tell(said: string | null) {
    this.told = said
  }

  failed(reason: string, shown?: number) {
    this.trouble = reason
    clearTimeout(this.shownFor)
    if (shown === undefined) {
      this.clearing()
      return
    }
    this.clearing.cancel()
    this.shownFor = setTimeout(() => {
      if (this.trouble === reason) this.trouble = null
    }, shown)
  }

  clear() {
    this.clearing.cancel()
    clearTimeout(this.shownFor)
    this.trouble = null
  }

  start(label: string, work: () => Promise<unknown>, once?: string) {
    if (once !== undefined) {
      if (this.underway.has(once)) return
      this.underway.add(once)
    }

    void this.run(label, work)
      .catch((error: unknown) => {
        console.error(error)
        this.failed(`${label}: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => {
        if (once !== undefined) this.underway.delete(once)
      })
  }
}

export const busy = new Busy()
