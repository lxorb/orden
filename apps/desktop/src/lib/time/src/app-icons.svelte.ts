import { invoke, isDesktop, isRecord, keepJson, stored } from '../../platform/src/api'

export const APP_ICONS = 'orden:app-icons'
const MOST = 200
const PICTURE = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i
const drawable = (picture: unknown): picture is string =>
  typeof picture === 'string' &&
  picture.length <= (picture.startsWith('data:image/svg+xml') ? 64 : 22) * 1024 &&
  PICTURE.test(picture)
function read(): Record<string, string> {
  const held = stored(APP_ICONS)
  if (!isRecord(held)) return {}
  return Object.fromEntries(Object.entries(held).filter((entry): entry is [string, string] => drawable(entry[1])))
}
class AppIcons {
  pictures = $state<Record<string, string>>(read())
  private asked: string[] = []
  of(app: string): string | null {
    const wanted = app.trim().toLowerCase()
    const found = Object.entries(this.pictures).find(([key]) => key.trim().toLowerCase() === wanted)
    return found?.[1] ?? null
  }
  seen(app: string): void {
    if (!isDesktop || !app || this.asked.includes(app) || this.of(app) !== null) return
    this.asked.push(app)
    void invoke<unknown>('app_icon', { app })
      .then((picture) => {
        if (!drawable(picture)) return
        const entries: [string, string][] = [...Object.entries(this.pictures), [app, picture]]
        const next = Object.fromEntries(entries.slice(-MOST))
        this.pictures = next
        keepJson(APP_ICONS, next)
      })
      .catch(() => undefined)
  }
}
export const appIcons = new AppIcons()
