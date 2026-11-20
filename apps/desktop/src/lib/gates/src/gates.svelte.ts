import { account } from '../../accounts/src/api'
import { modes } from '../../modes/src/api'
import { heardElsewhere, isDesktop, stored, stringList } from '../../platform/src/api'
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
  | 'explorer'
  | 'pass'
  | 'web'
  | 'private'
export function kindsHere(): KindName[] {
  const web = !viewport.touch
  const here: KindName[] = ['note', 'canvas', 'pages']
  if (account.accountToken && chatsOn()) here.push('chat')
  if (web) here.push('ai')
  if (isDesktop && modes.coder) here.push('terminal', 'remote')
  if (modes.coder) here.push('online')
  if (isDesktop && explorerOn()) here.push('explorer')
  if (passOn()) here.push('pass')
  if (web) here.push('web')
  if (web && isDesktop) here.push('private')
  return here
}
const GATED: readonly KindName[] = ['chat', 'explorer', 'pass']
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
  }
}
export const hiddenKinds = new HiddenKinds()
heardElsewhere([KINDS_KEY], () => hiddenKinds.restore())
export const EXPERIMENTAL_WORD = 'experimental'
export function experimentalOn(): boolean {
  return hiddenKinds.hidden.includes(EXPERIMENTAL_WORD)
}
function tried(word: string): boolean {
  return experimentalOn() && hiddenKinds.hidden.includes(word)
}
export const CHATS_WORD = 'experimental-chats'
export const EXPLORER_WORD = 'experimental-explorer'
export const PASS_WORD = 'experimental-pass'
export const TIME_WORD = 'experimental-time'
export const BASES_WORD = 'experimental-bases'
export function chatsOn(): boolean {
  return tried(CHATS_WORD)
}
export function explorerOn(): boolean {
  return tried(EXPLORER_WORD)
}
const passOnly = typeof document !== 'undefined' && document.documentElement.dataset.only === 'pass'
export function passOn(): boolean {
  return passOnly || tried(PASS_WORD)
}
export function timeOn(): boolean {
  return tried(TIME_WORD)
}
export function basesOn(): boolean {
  return tried(BASES_WORD)
}
