import { account } from './account.svelte'
import { api, type AccountSettings } from './api'
import {
  choiceWord,
  chosenOn,
  hiddenKinds,
  KINDS_KEY,
  type KindName,
  kindsHere,
  offUntilShown,
  shownOf,
} from './settings.svelte'
import { forget, isString, keepJson } from './stored'

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
  if (on === chosenOn(kind, hidden)) return
  if (!on && !mayHide(kind, kindsHere(), hidden)) return

  const rest = hidden.filter((one) => one !== kind && one !== choiceWord(kind))
  hiddenKinds.hidden = on === offUntilShown(kind) ? [...rest, choiceWord(kind)] : rest
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
  const token = account.accountToken
  if (!token) return

  const hidden = hiddenKinds.hidden
  const list = hidden.length ? [...hidden] : null
  void api.saveSettings(token, { hiddenKinds: list }).catch(() => undefined)
}
