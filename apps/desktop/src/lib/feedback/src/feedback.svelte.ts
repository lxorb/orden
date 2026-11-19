import { account, request } from '../../accounts/src/api'
import { scrubbedLog } from './feedback-log'
import {
  recentLog,
  invoke,
  isDesktop,
  isMobile,
  isNative,
  isRecord,
  keepJson,
  platform,
  stored,
} from '../../platform/src/api'

const LOG_LINES = 200
const LOG_BYTES = 60 * 1024

function platformLine(): string {
  const build = isMobile ? 'phone' : isDesktop ? 'desktop' : 'web'
  const system = isNative ? platform() : navigator.userAgent
  return `${build}, ${system}`.slice(0, 120)
}

async function logTail(): Promise<string> {
  const whole = isNative ? await invoke<string>('read_log').catch(() => '') : recentLog().join('\n')
  const tail = scrubbedLog(whole.split('\n').slice(-LOG_LINES).join('\n'))
  return tail.length > LOG_BYTES ? tail.slice(tail.length - LOG_BYTES) : tail
}

const MOST_PAST = 20
const LONGEST_TITLE = 80

interface Past {
  url: string
  title: string
  at: number
}

const pastKey = () => `orden:feedback-sent:${account.user?.id ?? ''}`

function readPast(): Past[] {
  const kept: unknown = stored(pastKey())
  if (!Array.isArray(kept)) return []
  return (kept as unknown[]).filter(
    (one): one is Past =>
      isRecord(one) && typeof one.url === 'string' && typeof one.title === 'string' && typeof one.at === 'number',
  )
}

interface Kept {
  ok?: unknown
  id?: unknown
  url?: unknown
}

class Feedback {
  open = $state(false)
  received = $state<{ url: string | null } | null>(null)
  past = $state<Past[]>([])

  show() {
    this.received = null
    this.past = readPast()
    this.open = true
  }

  close() {
    this.open = false
  }

  async send(text: string, pictures: readonly string[] = []): Promise<void> {
    const body = {
      text: text.trim(),
      version: __APP_VERSION__,
      platform: platformLine(),
      log: await logTail(),
      ...(pictures.length ? { images: pictures } : {}),
    }
    const kept = await request<Kept>('/v1/feedback', {
      body,
      ...(account.token ? { token: account.token } : {}),
    })
    if (kept.ok !== true) throw new Error('the service did not say it kept the report')
    const url = typeof kept.url === 'string' ? kept.url : null
    this.received = { url }
    if (!url) return
    const title = body.text.split('\n')[0]?.slice(0, LONGEST_TITLE) ?? ''
    this.past = [{ url, title, at: Date.now() }, ...readPast()].slice(0, MOST_PAST)
    keepJson(pastKey(), this.past)
  }
}

export const feedback = new Feedback()
