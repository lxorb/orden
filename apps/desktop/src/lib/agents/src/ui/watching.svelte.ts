import type { Picture } from '../verbs'

export const LOOK_EVERY = 2000

export class Watching {
  picture = $state<Picture | null>(null)

  failed = $state(false)

  private busy = false

  private again = false

  constructor(private readonly peek: () => Promise<Picture>) {}

  async look(): Promise<void> {
    if (this.busy) {
      this.again = true
      return
    }
    this.busy = true
    try {
      do await this.once()
      while (this.wanted())
    } finally {
      this.busy = false
    }
  }

  private wanted(): boolean {
    const again = this.again
    this.again = false
    return again
  }

  private async once(): Promise<void> {
    try {
      this.picture = await this.peek()
      this.failed = false
    } catch {
      this.failed = true
    }
  }
}
