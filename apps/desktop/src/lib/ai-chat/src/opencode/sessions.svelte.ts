import { keepJson, stored } from '../../../platform/src/api'

const SESSIONS = 'orden:opencode-sessions'
const SINCE = 'orden:opencode-since'
function kept(): Record<string, string> {
  const value = stored(SESSIONS)
  return typeof value === 'object' && value !== null ? (value as Record<string, string>) : {}
}
class OpenCodeSessions {
  held = $state<Record<string, string>>(kept())
  of(thread: string): string | undefined {
    return this.held[thread]
  }
  set(thread: string, session: string): void {
    this.held = { ...this.held, [thread]: session }
    keepJson(SESSIONS, this.held)
  }
  since(): number {
    const value = stored(SINCE)
    if (typeof value === 'number') return value
    const now = Date.now()
    keepJson(SINCE, now)
    return now
  }
  earlier(head: { id: string; updated: number }): boolean {
    return !this.of(head.id) && head.updated < this.since()
  }
}
export const openCodeSessions = new OpenCodeSessions()
