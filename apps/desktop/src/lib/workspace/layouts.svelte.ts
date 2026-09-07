/** Arrangements someone has named and can come back to.
 *
 *  A layout is the panes, the notes in each of them and the sidebar; the one on
 *  screen is the session, and these are copies of it under a name. They hold no
 *  words: a saved layout says which notes sit where, and the notes themselves
 *  live on disk. So applying one that was saved a week ago shows what those
 *  notes say now.
 *
 *  This machine's alone, like the sidebar width and the open folders: which
 *  arrangement suits a screen is a fact about the screen. */

import { isRecord, isString, stored } from '../stored'
import { type Layout, readLayout, withoutText } from './session'

const STORAGE_KEY = 'nib:layouts'

/** Enough for the ways anybody actually works, few enough to read in a list. */
const MOST = 20
const LONGEST_NAME = 60

export interface Saved {
  name: string
  layout: Layout
}

function readSaved(value: unknown): Saved | null {
  if (!isRecord(value) || !isString(value.name)) return null

  const layout = readLayout(value.layout)
  return layout && value.name.trim() ? { name: value.name, layout } : null
}

function readAll(value: unknown): Saved[] {
  if (!Array.isArray(value)) return []

  return value
    .map(readSaved)
    .filter((one): one is Saved => one !== null)
    .slice(0, MOST)
}

export class Layouts {
  all = $state<Saved[]>([])

  restore() {
    this.all = readAll(stored(STORAGE_KEY))
  }

  /** Keeps an arrangement under a name. The same name again replaces it, which
   *  is what saving over one means everywhere else. */
  save(name: string, layout: Layout) {
    const clean = name.trim().slice(0, LONGEST_NAME)
    if (!clean) return

    const kept: Saved = { name: clean, layout: withoutText(layout) }
    const rest = this.all.filter((one) => one.name !== clean)
    if (rest.length >= MOST) return

    this.all = [...rest, kept].sort((a, b) => a.name.localeCompare(b.name))
    this.write()
  }

  remove(name: string) {
    this.all = this.all.filter((one) => one.name !== name)
    this.write()
  }

  of(name: string): Layout | null {
    return this.all.find((one) => one.name === name)?.layout ?? null
  }

  private write() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.all))
    } catch {
      // Out of room. The layouts already written down stay, and the one that
      // did not fit is on screen anyway, which is where it came from.
    }
  }
}
