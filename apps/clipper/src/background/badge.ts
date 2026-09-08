/** What a clip from the page's own menu, or from a keyboard shortcut, looks
 *  like while it happens.
 *
 *  There is no popup open in either case, so the toolbar button is the whole
 *  surface: a dot while it works, a tick when the note exists, an exclamation
 *  when it does not. The sentence goes in the button's tooltip, which is the
 *  only place a service worker can put words without asking for permission to
 *  raise notifications. */

import { translate } from '../lib/translate'

/** The accent and the danger colour from `packages/themes/src/tokens.css`. A
 *  worker cannot read a stylesheet, so the two badge colours are the one place
 *  in the extension that names them again. */
const ACCENT = '#7c6bf5'
const DANGER = '#f2555a'

/** Long enough to notice, short enough not to become part of the toolbar. */
const KEPT = 1600
const KEPT_ON_FAILURE = 5000

/** An empty title is how Chrome is told to go back to the extension's own name,
 *  which `_locales` has already translated. */
const DEFAULT_TITLE = ''

function set(tabId: number, text: string, colour: string, title: string) {
  void chrome.action.setBadgeText({ tabId, text })
  void chrome.action.setBadgeBackgroundColor({ tabId, color: colour })
  void chrome.action.setTitle({ tabId, title })
}

function clearAfter(tabId: number, delay: number) {
  setTimeout(() => {
    void chrome.action.setBadgeText({ tabId, text: '' })
    void chrome.action.setTitle({ tabId, title: DEFAULT_TITLE })
  }, delay)
}

export function working(tabId: number): void {
  set(tabId, '·', ACCENT, DEFAULT_TITLE)
}

export function done(tabId: number, path: string): void {
  set(tabId, '✓', ACCENT, path)
  clearAfter(tabId, KEPT)
}

export function failed(tabId: number, problem: string, language: string): void {
  set(tabId, '!', DANGER, translate(language, problem))
  clearAfter(tabId, KEPT_ON_FAILURE)
}
