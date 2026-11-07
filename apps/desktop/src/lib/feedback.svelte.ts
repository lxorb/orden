import { account } from './account.svelte'
import { request } from './api'
import { scrubbedLog } from './feedback-log'
import { recentLog } from './log'
import { invoke, isDesktop, isMobile, isNative, platform } from './tauri'

const LOG_LINES = 200
const LOG_BYTES = 60 * 1024

function platformLine(): string {
  const build = isMobile ? 'phone' : isDesktop ? 'desktop' : 'web'
  const system = isNative ? platform() : navigator.userAgent
  return `${build} · ${system}`.slice(0, 120)
}

async function logTail(): Promise<string> {
  const whole = isNative ? await invoke<string>('read_log').catch(() => '') : recentLog().join('\n')
  const tail = scrubbedLog(whole.split('\n').slice(-LOG_LINES).join('\n'))
  return tail.length > LOG_BYTES ? tail.slice(tail.length - LOG_BYTES) : tail
}

interface Kept {
  ok?: unknown
  id?: unknown
  url?: unknown
}

class Feedback {
  open = $state(false)
  received = $state<{ url: string | null } | null>(null)

  show() {
    this.received = null
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
    this.received = { url: typeof kept.url === 'string' ? kept.url : null }
  }
}

export const feedback = new Feedback()
