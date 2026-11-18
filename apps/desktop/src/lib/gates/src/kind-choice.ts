import { AccountOwed, type AccountSettings } from '../../accounts/src/api'
import {
  chosenOn,
  gated,
  hiddenKinds,
  KINDS_KEY,
  type KindName,
  kindsHere,
  shownOf,
} from './gates.svelte'
import { forget, isString, keepJson } from '../../platform/src/api'

const OWED_KEY = 'orden:kinds-owed'

let owed: AccountOwed | null = null
const owing = () => (owed ??= new AccountOwed(OWED_KEY))

const MOST_KINDS = 32
const KIND = /^[a-z][a-z-]{0,23}$/

export function hiddenOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const words = value.filter((one): one is string => isString(one) && KIND.test(one))
  return [...new Set(words)].slice(0, MOST_KINDS)
}

export function mayHide(kind: KindName, here: readonly KindName[], hidden: readonly string[]) {
  const shown = shownOf(here, hidden)
  return shown.includes(kind) && shown.length > 1
}

export function turnedOff(kind: KindName): boolean {
  return !chosenOn(kind, hiddenKinds.hidden) && !hiddenKinds.offers(kind)
}

export function locked(kind: KindName): boolean {
  return hiddenKinds.offers(kind) && !mayHide(kind, kindsHere(), hiddenKinds.hidden)
}

export function setKind(kind: KindName, on: boolean) {
  const hidden = hiddenKinds.hidden
  if (gated(kind) || on === chosenOn(kind, hidden)) return
  if (!on && !mayHide(kind, kindsHere(), hidden)) return

  const rest = hidden.filter((one) => one !== kind)
  hiddenKinds.hidden = on ? rest : [...rest, kind]
  settle()
  share()
}

export function setWord(word: string, on: boolean) {
  const hidden = hiddenKinds.hidden
  if (on === hidden.includes(word)) return
  hiddenKinds.hidden = on ? [...hidden, word] : hidden.filter((one) => one !== word)
  settle()
  share()
}

export function receive(remote: AccountSettings) {
  const theirs = remote.hiddenKinds
  if (owing().standing) {
    share()
    return
  }
  if (theirs === undefined) {
    if (hiddenKinds.hidden.length) share()
    return
  }

  const taken = hiddenOf(theirs)
  if (taken.join('\0') === hiddenKinds.hidden.join('\0')) return

  hiddenKinds.hidden = taken
  settle()
}

function settle() {
  const hidden = hiddenKinds.hidden
  if (hidden.length) keepJson(KINDS_KEY, hidden)
  else forget(KINDS_KEY)
}

function share() {
  const hidden = hiddenKinds.hidden
  owing().send({ hiddenKinds: hidden.length ? [...hidden] : null })
}
