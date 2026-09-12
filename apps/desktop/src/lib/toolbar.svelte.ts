/** What the phone's format bar holds.
 *
 *  The bar over the keyboard is the only toolbar nib has, and what belongs on it
 *  is not something one list of nine can be right about for everybody: somebody
 *  writing prose wants Bold and Quote, somebody keeping a journal wants a task
 *  and a heading, and both are right. So the buttons are a list of command ids
 *  the reader owns, and it goes on the account beside the shortcuts.
 *
 *  Ids from the one registry that holds every command whole - the shortcuts list,
 *  which carries the app entries' own `run` and the editor bindings' specs - so a
 *  button presses exactly what the key presses; see shortcuts/registry.ts and
 *  `runEntry` there. Nothing here knows what any command does.
 *
 *  A mark rather than an icon. The bar is a strip of thumb-width buttons and it
 *  has always drawn one character on each: the icon set is loaded on demand and
 *  is larger than the app around it, and a row of little pictures over the
 *  keyboard is what every other editor's bar looks like. Where a command has a
 *  typographic mark of its own it wears that, and everything else wears the first
 *  letter of its own name - which is what B, I and S already were.
 *
 *  Stored as nothing at all while it is the default, which is the same rule the
 *  shortcuts follow: a list written out in full would freeze today's nine into
 *  every device that ever opened the pane, and a default that grew later would
 *  never reach anybody. */

import Link from 'lucide/dist/esm/icons/link.mjs'
import type { IconNode } from 'lucide'
import { account } from './account.svelte'
import { api, type AccountSettings } from './api'
import { BY_ID, runnable } from './shortcuts/registry'
import { isString, stored } from './stored'

const STORAGE_KEY = 'nib:toolbar'

/** How many the account will carry. The same number the server enforces; see
 *  services/sync/src/settings.ts. Well past what a phone can show at once,
 *  because a bar longer than the screen scrolls rather than being refused. */
const MOST_BUTTONS = 24

/** The bar as it has always been: the nine formatting actions, in the order they
 *  were in before any of this could be changed. Each is the id of the command the
 *  button already ran. */
export const DEFAULT_TOOLBAR: readonly string[] = [
  'format.bold',
  'format.italic',
  'format.strikethrough',
  'format.highlight',
  'format.code',
  'paragraph.heading-2',
  'paragraph.quote',
  'format.link',
  'format.clear',
]

/** The marks, for the commands that have one. A mark is a character somebody
 *  already reads as the thing: B is bold in every word processor there has been,
 *  `#` is a link in this app's own vocabulary, and a bullet is a bullet.
 *
 *  Not a mark per command. The rest take the first letter of their name, which is
 *  a letter in the reader's own language and needs no table. */
const MARKS: Record<string, string> = {
  'format.bold': 'B',
  'format.italic': 'I',
  'format.strikethrough': 'S',
  'format.highlight': 'M',
  'format.underline': 'U',
  'format.code': '<>',
  'format.clear': '×',
  'format.comment': '//',
  'paragraph.body': '¶',
  'paragraph.heading-1': 'H1',
  // The bar's own H, which has been heading two since there was a bar.
  'paragraph.heading-2': 'H',
  'paragraph.heading-3': 'H3',
  'paragraph.heading-4': 'H4',
  'paragraph.heading-5': 'H5',
  'paragraph.heading-6': 'H6',
  'paragraph.heading-up': 'H+',
  'paragraph.heading-down': 'H-',
  'paragraph.quote': '"',
  'paragraph.bullet-list': '•',
  'paragraph.ordered-list': '1.',
  'paragraph.task-list': '☐',
  'paragraph.task': '☑',
  'paragraph.math-block': '∑',
  'paragraph.toc': '≡',
  'paragraph.rule': '––',
}

/** The commands no letter says. `#` said Link on this bar once and `#` is how a
 *  tag starts in nib's markdown, with `H` already standing for Heading: one
 *  character cannot mean both, so a link is the chain Lucide draws it with, which
 *  is the set the whole interface is drawn in.
 *
 *  One icon rather than a set: the icons are loaded on demand and the whole of
 *  Lucide is larger than the app, so a glyph here is a single-file import and
 *  there are as few of them as the bar can manage. */
const GLYPHS: Record<string, IconNode> = {
  'format.link': Link,
}

/** Marks whose ink sits at the top of their own em box rather than across the
 *  middle of it: a quotation mark is set where quotes go in running text, which
 *  on a row read across the middle is a mark sitting high in its cell. */
const HIGH = new Set(['paragraph.quote'])

/** The glyph a button wears instead of a mark, where it has one. */
export function glyphFor(id: string): IconNode | null {
  return GLYPHS[id] ?? null
}

/** Whether the mark is one that has to be pulled down into its row. */
export function lowMark(id: string): boolean {
  return HIGH.has(id)
}

/** What a button draws: the command's own mark, or the first letter of its name.
 *
 *  Upper case for the letter, because the marks are: a row of capitals and
 *  symbols reads as a row of buttons, and a lower-case letter among them reads as
 *  a typo. */
export function markFor(id: string): string {
  const mark = MARKS[id]
  if (mark) return mark

  // One grapheme rather than one code unit: a name in a language whose first
  // letter is two units long would otherwise be cut in half.
  const label = BY_ID.get(id)?.label() ?? id
  const first = new Intl.Segmenter().segment(label)[Symbol.iterator]().next().value?.segment
  return first?.toLocaleUpperCase() ?? '?'
}

/** What a button says it is, for the pointer that hovers it and the reader who is
 *  listening. The command's own name, which is the name the palette and the
 *  settings use for it. */
export function nameFor(id: string): string {
  return BY_ID.get(id)?.label() ?? id
}

class Toolbar {
  /** The reader's own list, or null while it is the default one.
   *
   *  Null rather than a copy of the default, so that the default can change and
   *  reach everybody who never chose. */
  chosen = $state<string[] | null>(null)

  /** What the bar draws, which is the whole point of this. */
  get ids(): readonly string[] {
    return this.chosen ?? DEFAULT_TOOLBAR
  }

  get changed(): boolean {
    return this.chosen !== null
  }

  restore() {
    const held = stored(STORAGE_KEY)
    this.chosen = usable(held)
  }

  /** Puts one on the end. A command already on the bar is not added twice: the
   *  bar is a set of buttons and two of anything would be two ways to press one
   *  thing. */
  add(id: string) {
    if (!runnable(id) || this.ids.includes(id) || this.ids.length >= MOST_BUTTONS) return

    this.chosen = [...this.ids, id]
    this.settle()
  }

  remove(id: string) {
    if (!this.ids.includes(id)) return

    this.chosen = this.ids.filter((one) => one !== id)
    this.settle()
  }

  /** Moves one along the bar, which is what dragging a row does and what the two
   *  arrows beside a row do. Out of range is a move that does nothing rather than
   *  a refusal: a drag that ends past the end means the end. */
  move(from: number, to: number) {
    const list = [...this.ids]
    const held = list[from]
    if (held === undefined) return

    const landing = Math.max(0, Math.min(list.length - 1, to))
    if (landing === from) return

    list.splice(from, 1)
    list.splice(landing, 0, held)

    this.chosen = list
    this.settle()
  }

  /** Back to the nine, and back to having chosen nothing - so a default that
   *  changes later reaches this device too. */
  reset() {
    this.chosen = null
    this.settle()
  }

  private settle() {
    try {
      if (this.chosen) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.chosen))
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // A browser told to keep no site data still has a bar; it is this run's
      // bar rather than this device's.
    }

    this.share()
  }

  /** Takes over the account's list. The last machine to change it wins, which is
   *  the rule every other account setting follows: a bar merged button by button
   *  would be a bar neither machine chose. */
  receive(remote: AccountSettings) {
    const theirs = remote.toolbar
    // An account that has never been told anything about the bar takes this
    // machine's, so a list made before signing in follows the account in rather
    // than being lost at the door.
    if (theirs === undefined) {
      if (this.chosen) this.share()
      return
    }

    const usableOnes = theirs === null ? null : usable(theirs)
    if (JSON.stringify(usableOnes) === JSON.stringify(this.chosen)) return

    this.chosen = usableOnes
    try {
      if (usableOnes) localStorage.setItem(STORAGE_KEY, JSON.stringify(usableOnes))
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // As above: nothing to do about a store that will not be written.
    }
  }

  private share() {
    const token = account.accountToken
    if (!token) return

    // Null says "the default", which is a choice like any other and has to
    // travel: without it another machine could never learn that this one went
    // back.
    void api.saveSettings(token, { toolbar: this.chosen }).catch(() => undefined)
  }
}

/** A stored or received list, cleaned: ids only, nothing twice, nothing this
 *  version cannot press, and no more than the account will carry.
 *
 *  An id this version has never heard of is dropped rather than kept, which is
 *  the opposite of what the shortcuts do with one - and for the opposite reason.
 *  A key nobody can press is invisible until the version that knows it arrives; a
 *  button nobody can press is a hole in a row of nine. */
export function usable(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null

  const out: string[] = []
  for (const one of value) {
    if (!isString(one) || out.includes(one) || !runnable(one)) continue
    out.push(one)
    if (out.length >= MOST_BUTTONS) break
  }

  // An empty list is a bar with nothing on it, which is a thing somebody may
  // want: the keyboard's own row and nothing above it.
  return out.length || value.length === 0 ? out : null
}

export const toolbar = new Toolbar()
