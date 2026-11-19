import { hub } from '../../../sync-client/src/api'
import { endSession, type Listed, listed } from './calls'

class OnlineSessions {
  list = $state<Listed[] | null>(null)
  failed = $state(false)
  private asked = 0
  async refresh(): Promise<void> {
    const turn = ++this.asked
    try {
      const list = await listed()
      if (turn !== this.asked) return
      this.list = list
      this.failed = false
    } catch {
      if (turn === this.asked) this.failed = true
    }
  }
  watch(): () => void {
    return hub.on('terms', () => {
      void this.refresh()
    })
  }
  async end(one: Listed): Promise<void> {
    if (this.list) this.list = this.list.filter((other) => other.session !== one.session)
    await endSession(one.term ?? one.session).catch(() => undefined)
    await this.refresh()
  }
}
export const sessions = new OnlineSessions()
