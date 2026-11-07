import { t } from '../i18n.svelte'
import { keep, storedText } from '../stored'
import { invoke, isDesktop, platform } from '../tauri'
import { keptInTray } from '../parting'

const KEY = 'orden.tray'

type Choice = 'auto' | 'on' | 'off'

export const hasTray = isDesktop && ['windows', 'macos'].includes(platform())

function choiceOf(text: string | null): Choice {
  return text === 'on' || text === 'off' ? text : 'auto'
}

const hide = (): Promise<boolean> =>
  invoke<boolean>('agents_hold', { hide: true }).catch(() => false)

class Residency {
  choice = $state<Choice>(choiceOf(storedText(KEY)))

  waiting = $state(false)

  quickAdd = $state(false)

  chats = $state(false)

  get on(): boolean {
    if (!hasTray) return false
    if (this.choice !== 'auto') return this.choice === 'on'
    return this.waiting || this.quickAdd || this.chats
  }

  set(on: boolean) {
    this.choice = on ? 'on' : 'off'
    keep(KEY, this.choice)
    this.apply()
  }

  apply(on = this.on) {
    keptInTray(on ? hide : null)
    if (!hasTray) return
    void invoke('tray_keep', { on, words: { show: t('Open'), quit: t('Quit') } }).catch(
      () => undefined,
    )
  }
}

export const residency = new Residency()
