import { type Hours, isHours, isKeywords, MUTED_FOR_GOOD } from '@orden/chats/notify'
import { account, api, type AccountSettings, stands } from '../../accounts/src/api'
import { isBoolean, isRecord, keepJson, stored } from '../../platform/src/api'

const KEY = 'orden.chat-hush'

export const WEEKDAYS = [1, 2, 3, 4, 5]
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

export const WORKING_HOURS: Hours = { days: WEEKDAYS, from: 9 * 60, to: 18 * 60 }

class Hush {
  keywords = $state<string[]>([])
  hours = $state<Hours | null>(null)
  previews = $state(true)
  sound = $state(false)

  constructor() {
    const saved = stored(KEY)
    if (isRecord(saved)) this.took(saved)
  }

  setKeywords(line: string) {
    const words = [
      ...new Set(
        line
          .split(',')
          .map((one) => one.trim())
          .filter(Boolean),
      ),
    ]
    if (!isKeywords(words) || words.join('\0') === this.keywords.join('\0')) return
    this.keywords = words
    this.changed({ chatKeywords: words })
  }

  setHours(hours: Hours | null) {
    if (hours !== null && !isHours(hours)) return
    this.hours = hours
    this.changed({ chatHours: hours })
  }

  setPreviews(on: boolean) {
    this.previews = on
    this.changed({ chatPreviews: on })
  }

  setSound(on: boolean) {
    this.sound = on
    this.changed({ chatSound: on })
  }

  receive(remote: AccountSettings) {
    this.took({
      keywords: remote.chatKeywords,
      hours: remote.chatHours,
      previews: remote.chatPreviews,
      sound: remote.chatSound,
    })
    this.persist()
  }

  private took(value: Record<string, unknown>) {
    if (isKeywords(value.keywords)) this.keywords = value.keywords
    if (value.hours === null || isHours(value.hours)) this.hours = value.hours
    if (isBoolean(value.previews)) this.previews = value.previews
    if (isBoolean(value.sound)) this.sound = value.sound
  }

  private changed(patch: AccountSettings) {
    this.persist()
    const token = account.accountToken
    if (token) void api.saveSettings(token, patch).catch(() => undefined)
  }

  private persist() {
    keepJson(KEY, {
      keywords: this.keywords,
      hours: this.hours,
      previews: this.previews,
      sound: this.sound,
    })
  }
}

export const hush = /* @__PURE__ */ new Hush()

export function dndUntil(): number | null {
  const status = account.user?.status
  if (!status?.quiet || !stands(status, Date.now())) return null
  return status.until ?? MUTED_FOR_GOOD
}
