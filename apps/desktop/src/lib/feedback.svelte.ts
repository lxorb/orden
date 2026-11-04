/** Send feedback (#548): the bug at the foot of the sidebar and the palette's row open a
 *  sheet that sends what somebody wrote about a problem to the service, with Orden's
 *  version, the platform and the recent app log - and nothing of their notes.
 *
 *  Emil: *"add this to the bottom left to orden as well please"*. Signed in or not: a
 *  report from somebody who cannot sign in is often the one that matters. The account's
 *  session goes with it where there is one, so the report says whose it is. See
 *  services/sync/src/feedback.ts, and FeedbackSheet.svelte for the sheet.
 *
 *  What the service answers is the report's page (#1087): it says the report arrived
 *  only once the service has kept it, and the sheet shows that page's address for the
 *  reader to follow, in a tab of Orden's own. The repository the report's issue goes to
 *  is private, so the page is what its sender can see. Pictures go with the words; see
 *  feedback-pictures.ts. */

import { account } from './account.svelte'
import { request } from './api'
import { scrubbedLog } from './feedback-log'
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
 *  this visit, with the reader's paths out of it (feedback-log.ts). */
async function logTail(): Promise<string> {
  const whole = isNative ? await invoke<string>('read_log').catch(() => '') : recentLog().join('\n')
  const tail = scrubbedLog(whole.split('\n').slice(-LOG_LINES).join('\n'))
  return tail.length > LOG_BYTES ? tail.slice(tail.length - LOG_BYTES) : tail
}

/** What the service answers a report it kept with. */
interface Kept {
  ok?: unknown
  id?: unknown
  url?: unknown
}

class Feedback {
  /** Whether the sheet is up. */
  open = $state(false)
  /** The last report the service said it kept, and where its page is: what the sheet
   *  confirms. Null until one has been, and again each time the sheet opens. */
  received = $state<{ url: string | null } | null>(null)

  show() {
    this.received = null
    this.open = true
  }

  close() {
    this.open = false
  }

  /** The report on its way: the words, the pictures, the version, the platform and the
   *  log's end. Says it was received only once the service answers that it kept it;
   *  throws what went wrong otherwise, for the sheet to show, and nothing is received. */
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
