import { account } from '../../accounts/src/api'
import { modes } from '../../modes/src/api'
import { isDesktop, stored, stringList } from '../../platform/src/api'
import { viewport } from '../../ui-kit/src/api'

export const KINDS_KEY = 'orden:hidden-kinds'

export type KindName =
  | 'note'
  | 'canvas'
  | 'pages'
  | 'chat'
  | 'ai'
  | 'terminal'
  | 'remote'
  | 'online'
  | 'application'
  | 'explorer'
  | 'pass'
  | 'web'
  | 'private'

export function kindsHere(): KindName[] {
  if (__EVEN_PLUGIN__) return ['note', 'canvas', 'pages']

  const web = !viewport.touch
  const here: KindName[] = ['note', 'canvas', 'pages']
  if (account.accountToken && chatsOn()) here.push('chat')
  if (web) here.push('ai')
  if (isDesktop && modes.coder) here.push('terminal', 'remote')
  if (modes.coder) here.push('online')
  if (appsOn()) here.push('application')
  if (isDesktop && explorerOn()) here.push('explorer')
  if (passOn()) here.push('pass')
  if (web) here.push('web')
  if (web && isDesktop) here.push('private')
  return here
}

const GATED: readonly KindName[] = ['chat', 'application', 'explorer', 'pass']

export function gated(kind: KindName): boolean {
  return GATED.includes(kind)
}

export function chosenOn(kind: KindName, hidden: readonly string[]): boolean {
  return gated(kind) || !hidden.includes(kind)
}

export function shownOf(here: readonly KindName[], hidden: readonly string[]): KindName[] {
  const shown = here.filter((kind) => chosenOn(kind, hidden))
  return shown.length ? shown : here.slice(0, 1)
}

class HiddenKinds {
  hidden = $state<readonly string[]>([])

  get shown(): KindName[] {
    return shownOf(kindsHere(), this.hidden)
  }

  offers(kind: KindName): boolean {
    return this.shown.includes(kind)
  }

  restore() {
    this.hidden = stringList(stored(KINDS_KEY)) ?? []
    this.hearOthers()
  }

  private hearing = false
  private hearOthers() {
    if (this.hearing || typeof window === 'undefined') return
    this.hearing = true
    window.addEventListener('storage', (event) => {
      if (event.key === KINDS_KEY) this.restore()
    })
  }
}

export const hiddenKinds = new HiddenKinds()

export const EXPERIMENTAL_WORD = 'experimental'

export function experimentalOn(): boolean {
  return hiddenKinds.hidden.includes(EXPERIMENTAL_WORD)
}

function tried(word: string): boolean {
  return experimentalOn() && hiddenKinds.hidden.includes(word)
}

export const CHATS_WORD = 'experimental-chats'
export const APPS_WORD = 'experimental-apps'
export const EXPLORER_WORD = 'experimental-explorer'
export const PASS_WORD = 'experimental-pass'
export const TIME_WORD = 'experimental-time'
export const BASES_WORD = 'experimental-bases'
export const GLASSES_WORD = 'experimental-glasses'

export function chatsOn(): boolean {
  return !__EVEN_PLUGIN__ && tried(CHATS_WORD)
}

export function appsOn(): boolean {
  return !__EVEN_PLUGIN__ && tried(APPS_WORD)
}

export function explorerOn(): boolean {
  return !__EVEN_PLUGIN__ && tried(EXPLORER_WORD)
}

const passOnly = typeof document !== 'undefined' && document.documentElement.dataset.only === 'pass'

export function passOn(): boolean {
  return !__EVEN_PLUGIN__ && (passOnly || tried(PASS_WORD))
}

export function timeOn(): boolean {
  return !__EVEN_PLUGIN__ && tried(TIME_WORD)
}

export function basesOn(): boolean {
  return tried(BASES_WORD)
}

export function glassesOn(): boolean {
  return tried(GLASSES_WORD)
}
