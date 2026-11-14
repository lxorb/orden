import type { LinkPress, NoteJump, NoteOpener } from '@orden/editor'
import { howFor, linkAsk, type TabAsk, tabAsk } from './new-tab'
import { isPlugin } from './plugin'
import { isOpenable, openExternal } from './platform/src/api'
import { viewport } from './ui-kit/src/api'
import { isWebAddress } from './web-tab/address'
import { workspace } from './workspace.svelte'

export type LinkPlace = 'here' | 'behind' | 'system' | 'nowhere'

const MAIN = 0
export const MIDDLE = 1

export function opensLink(press: LinkPress): boolean {
  return press.button === MAIN || press.button === MIDDLE
}

export function webHref(href: string): string | null {
  const said = href.startsWith('//') ? `https:${href}` : href
  return isWebAddress(said) ? said : null
}

function holdsPages(): boolean {
  return !isPlugin() && !viewport.touch
}

export function placeFor(href: string, ask: TabAsk, pages = holdsPages()): LinkPlace {
  if (!isOpenable(href)) return 'nowhere'
  if (webHref(href) === null || !pages) return 'system'

  return ask === 'behind' ? 'behind' : 'here'
}

export function settingsPane(href: string): 'import' | null {
  return !__EVEN_PLUGIN__ && /^(orden|nib):\/\/settings\/import\/?$/i.test(href.trim())
    ? 'import'
    : null
}

export function followHref(href: string, press: LinkPress): void {
  const pane = settingsPane(href)
  if (pane) {
    void import('./settings.svelte').then(({ settings }) => settings.show(pane))
    return
  }
  const ask = tabAsk(press, true)
  if (/^(orden|nib):\/\/chat\//i.test(href)) {
    const opening = __EVEN_PLUGIN__ ? null : import('./chats/view/open')
    void opening?.then(({ openChatLink }) => openChatLink(href, howFor(ask)))
    return
  }
  const place = placeFor(href, ask)
  if (place === 'nowhere') return

  if (place === 'system') {
    void openExternal(href)
    return
  }

  const page = webHref(href)
  if (page !== null) workspace.openPage(page, ask)
}

export function followNote(jump: NoteJump, press?: LinkPress, from?: string | null): void {
  void workspace.followLink(jump, press ? linkAsk(press) : 'plain', from)
}

export function followNoteFrom(from: string | null): NoteOpener {
  return (jump, press) => followNote(jump, press, from)
}

const PLAIN: LinkPress = { button: MAIN, ctrlKey: false, metaKey: false, shiftKey: false }

export function openHref(href: string): void {
  followHref(href, PLAIN)
}
