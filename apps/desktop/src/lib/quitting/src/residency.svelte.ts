import { keep, storedText, invoke, isDesktop, platform } from '../../platform/src/api'
import { keptInTray } from '../../parting/src/api'

const KEY = 'orden.tray'
type Choice = 'auto' | 'on' | 'off'
export const hasTray = isDesktop && ['windows', 'macos'].includes(platform())
function choiceOf(text: string | null): Choice {
  return text === 'on' || text === 'off' ? text : 'auto'
}
const hide = (): Promise<boolean> => invoke<boolean>('agents_hold', { hide: true }).catch(() => false)
class Residency {
  choice = $state<Choice>(choiceOf(storedText(KEY)))
  #chats = $state(false)
  #applied: boolean | null = null
  get chats(): boolean {
    return this.#chats
  }
  set chats(any: boolean) {
    this.#chats = any
    this.apply()
  }
  get on(): boolean {
    if (!hasTray) return false
    if (this.choice !== 'auto') return this.choice === 'on'
    return this.#chats
  }
  set(on: boolean) {
    this.choice = on ? 'on' : 'off'
    keep(KEY, this.choice)
    this.apply()
  }
  apply() {
    const on = this.on
    if (on === this.#applied) return
    this.#applied = on
    keptInTray(on ? hide : null)
    if (!hasTray) return
    void invoke('tray_keep', { on, words: { show: 'Open', quit: 'Quit' } }).catch(() => undefined)
  }
}
export const residency = new Residency()
