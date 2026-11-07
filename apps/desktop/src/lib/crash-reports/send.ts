import { ApiError, request } from '../api'
import { invoke } from '../tauri'
import { type CrashReport, scrubbedReport } from './scrub'

export interface Sending {
  on(): boolean
  channel(): string
  waiting(): Promise<CrashReport[]>
  sent(id: string): Promise<void>
  unsent(id: string): Promise<void>
  post(report: CrashReport): Promise<unknown>
}

type Sent = 'done' | 'later' | 'off'

export async function sendWaiting(how: Sending): Promise<Sent> {
  const waiting = await how.waiting()
  if (!how.on()) {
    for (const one of waiting) await how.sent(one.id)
    return 'off'
  }
  for (const [at, one] of waiting.entries()) {
    const report = scrubbedReport({ ...one, app: { ...one.app, channel: how.channel() } })
    try {
      await how.post(report)
      await how.sent(one.id)
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        await how.sent(one.id)
        continue
      }
      for (const left of waiting.slice(at)) await how.unsent(left.id)
      return 'later'
    }
  }
  return 'done'
}

export function nativeSending(on: () => boolean, channel: () => string): Sending {
  return {
    on,
    channel,
    waiting: () => invoke<CrashReport[]>('crash_reports_waiting'),
    sent: (id) => invoke('crash_report_sent', { id }),
    unsent: (id) => invoke('crash_report_unsent', { id }),
    post: (report) => request('/v1/crashes', { body: report }),
  }
}
