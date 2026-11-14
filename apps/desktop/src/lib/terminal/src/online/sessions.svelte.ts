import { hub } from '../../../sync-client/src/api'
import { endSession, type Listed, listed } from './calls'

class OnlineSessions {
  list = $state<Listed[] | null>(null)
  failed = $state(false)

  async refresh(): Promise<void> {
    try {
      this.list = await listed()
      this.failed = false
    } catch {
      this.failed = true
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
