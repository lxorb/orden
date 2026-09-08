/** The service worker: the three ways a clip is asked for, and the one path
 *  they all take.
 *
 *  Chrome stops this worker between clips, so nothing is kept in memory here.
 *  Every handler reads what it needs from `chrome.storage` on the way in and
 *  puts back what changed; the language comes with it, because the menus and
 *  the tooltips are words. */

import { done, failed, working } from './badge'
import { clip, save } from './clip'
import { firstOf, refreshSpaces } from '../lib/account'
import { type Kind, KINDS, LABELS } from '../lib/kinds'
import { type Answer, type Ask, readAsk } from '../lib/messages'
import { PROBLEMS } from '../lib/problems'
import { settings, type Settings } from '../lib/settings'
import { translate } from '../lib/translate'

type Menus = NonNullable<chrome.contextMenus.CreateProperties['contexts']>

/** Which of the page's menus each action belongs on: the words under the
 *  cursor, the link under the cursor, or the page itself. */
const WHERE: Record<Kind, Menus> = {
  page: ['page', 'image'],
  selection: ['selection'],
  link: ['link'],
}

const EVERYWHERE: Menus = ['page', 'selection', 'link', 'image']

const PARENT = 'nib'

/** One entry called Nib with the three actions under it: the same three words
 *  the popup shows, in the same order. */
async function buildMenus() {
  const { language } = await settings()
  await chrome.contextMenus.removeAll()

  chrome.contextMenus.create({ id: PARENT, title: 'Nib', contexts: EVERYWHERE })

  for (const kind of KINDS) {
    chrome.contextMenus.create({
      id: kind,
      parentId: PARENT,
      title: translate(language, LABELS[kind]),
      contexts: WHERE[kind],
    })
  }
}

/** The space a clip goes to with nobody there to choose one: the last one saved
 *  to, or the first in the rail. */
async function targetSpace(held: Settings): Promise<string> {
  const remembered = firstOf(held.spaces, held.target.spaceId)
  if (remembered) return remembered

  // The remembered space may have been deleted since, or there may never have
  // been one; either way the list is worth asking for once. A network that is
  // not there reads as no spaces, which is a sentence the person can act on.
  const listed = await refreshSpaces(held.token ?? '').catch(() => [])
  return firstOf(listed, '')
}

/** A clip with no popup in front of it: the page's own menu, or a shortcut. It
 *  goes where the last one went, and the toolbar button says how it went. */
async function straightToNotes(kind: Kind, tabId: number, link: string | null) {
  const held = await settings()
  const say = (problem: string) => {
    failed(tabId, problem, held.language)
  }

  working(tabId)

  if (!held.token) {
    say(PROBLEMS.signIn)
    return
  }

  const spaceId = await targetSpace(held)
  if (!spaceId) {
    say(PROBLEMS.noSpaces)
    return
  }

  const made = await clip(kind, tabId, link)
  if ('problem' in made) {
    say(made.problem)
    return
  }

  const saved = await save(made.clip, spaceId, held.target.folder)
  if ('problem' in saved) say(saved.problem)
  else done(tabId, saved.path)
}

/** The popup has somewhere to show a sentence itself, and translates it there,
 *  so nothing here touches the badge or the dictionaries. */
async function answer(asked: Ask): Promise<Answer> {
  if (asked.ask === 'save') return save(asked.clip, asked.spaceId, asked.folder)

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id === undefined) return { problem: PROBLEMS.blocked }

  return clip(asked.kind, tab.id, null)
}

chrome.runtime.onInstalled.addListener(() => void buildMenus())
chrome.runtime.onStartup.addListener(() => void buildMenus())

// The menu titles are words, so they are written again when the language is.
chrome.storage.onChanged.addListener((changes) => {
  if ('nib:language' in changes) void buildMenus()
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const kind = KINDS.find((one) => one === info.menuItemId)
  if (!kind || tab?.id === undefined) return

  void straightToNotes(kind, tab.id, info.linkUrl ?? null)
})

chrome.commands.onCommand.addListener((command, tab) => {
  const kind = KINDS.find((one) => `clip-${one}` === command)
  if (!kind || tab?.id === undefined) return

  void straightToNotes(kind, tab.id, null)
})

chrome.runtime.onMessage.addListener((message: unknown, _sender, respond) => {
  const asked = readAsk(message)
  if (!asked) return false

  void answer(asked).then(respond)

  // The answer is a round trip to the page or to the API, so the channel is
  // held open until it arrives.
  return true
})
