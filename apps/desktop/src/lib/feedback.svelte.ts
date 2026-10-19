/** Send feedback (#548): the bug at the foot of the sidebar and the palette's row open a
 *  sheet that sends what somebody wrote about a problem to the service, with Orden's
 *  version, the platform and the recent app log - and nothing of their notes.
 *
 *  Emil: *"add this to the bottom left to orden as well please"*. Signed in or not: a
 *  report from somebody who cannot sign in is often the one that matters. The account's
 *  session goes with it where there is one, so the report says whose it is. See
 *  services/sync/src/feedback.ts, and FeedbackSheet.svelte for the sheet. */

import { account } from './account.svelte'
import { request } from './api'
import { recentLog } from './log'
import { invoke, isDesktop, isMobile, isNative, platform } from './tauri'

/** How much of the app's log goes with a report: its last lines, which are the ones
 *  about what just went wrong, within what the service takes. */
const LOG_LINES = 200
const LOG_BYTES = 60 * 1024

/** The platform as one line: which build, and the system under it. */
export function platformLine(): string {
  const build = isMobile ? 'phone' : isDesktop ? 'desktop' : 'web'
  const system = isNative ? platform() : navigator.userAgent
  return `${build} · ${system}`.slice(0, 120)
}

/** The end of the app's log: the file the native app writes, or what a page kept of
 *  this visit. */
async function logTail(): Promise<string> {
  const whole = isNative ? await invoke<string>('read_log').catch(() => '') : recentLog().join('\n')
  const tail = whole.split('\n').slice(-LOG_LINES).join('\n')
  return tail.length > LOG_BYTES ? tail.slice(tail.length - LOG_BYTES) : tail
}

class Feedback {
  /** Whether the sheet is up. */
  open = $state(false)

  show() {
    this.open = true
  }

  close() {
    this.open = false
  }

  /** The report on its way: the words, the version, the platform and the log's end.
   *  Throws what the service said, for the sheet to show. */
  async send(text: string): Promise<void> {
    const body = {
      text: text.trim(),
      version: __APP_VERSION__,
      platform: platformLine(),
      log: await logTail(),
    }
    await request<{ ok: true }>('/v1/feedback', {
      body,
      ...(account.token ? { token: account.token } : {}),
    })
  }
}

export const feedback = new Feedback()
