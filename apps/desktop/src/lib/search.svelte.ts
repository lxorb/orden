/** The Search panel: what was asked, what came back, and what a replacement
 *  would do to it.
 *
 *  A store rather than state inside the panel, because two places reach it: a
 *  bookmarked search runs from the row above the file list, and the panel has
 *  to show what it asked. */

import { SvelteSet } from 'svelte/reactivity'
import { changesFor } from './search/apply'
import type { Hit } from './search/match'
import { isEmpty, parseQuery } from './search/query'
import { searchSpace } from './search/space'
import { workspace } from './workspace.svelte'

/** How long after the last keystroke to ask. Long enough that a word typed at
 *  speed is one search, short enough that it does not feel like waiting. */
const WAIT = 140

/** How many hits are worth showing. Past this the panel is a second copy of
 *  the space rather than an answer. */
const MOST = 200

/** Two letters, so a single one does not fetch the whole space on its way to
 *  becoming a word. */
const SHORTEST = 2

const keyOf = (hit: Hit) => `${hit.path}:${hit.line}`

class Search {
  text = $state('')
  hits = $state<Hit[]>([])
  /** True from the keystroke until the last note has answered. */
  running = $state(false)
  /** Whether the replacement field is open. */
  replacing = $state(false)
  replacement = $state('')

  /** The hits the reader has turned off. Everything found is on to begin with,
   *  so what is worth keeping is the exceptions. */
  private readonly skipped = new SvelteSet<string>()

  private timer: ReturnType<typeof setTimeout> | undefined
  /** Which search is the latest. Typing outruns the disk, and answers to a
   *  word that is no longer in the field are dropped rather than shown. */
  private round = 0
  /** Which space the words in the field are a question about. */
  private about: string | null = null

  readonly query = $derived(parseQuery(this.text))
  readonly asks = $derived(this.text.trim().length >= SHORTEST && !isEmpty(this.query))
  readonly chosen = $derived(this.hits.filter((hit) => !this.skipped.has(keyOf(hit))))

  /** Whether a hit will be replaced. */
  keeps(hit: Hit): boolean {
    return !this.skipped.has(keyOf(hit))
  }

  toggle(hit: Hit) {
    const key = keyOf(hit)
    if (this.skipped.has(key)) this.skipped.delete(key)
    else this.skipped.add(key)
  }

  /** A new question. Every keystroke comes through here. */
  ask(text: string) {
    this.text = text
    this.about = workspace.activeSpace?.root ?? null
    clearTimeout(this.timer)
    this.round++

    if (!this.asks) {
      this.hits = []
      this.running = false
      return
    }

    this.running = true
    this.timer = setTimeout(() => void this.run(), WAIT)
  }

  /** Opens or shuts the replacement field. Shutting it turns every hit back
   *  on, so opening it again never starts from somebody else's choices. */
  toggleReplace() {
    this.replacing = !this.replacing
    if (!this.replacing) this.skipped.clear()
  }

  closeReplace() {
    if (!this.replacing) return

    this.replacing = false
    this.skipped.clear()
  }

  clear() {
    clearTimeout(this.timer)
    this.round++
    this.text = ''
    this.about = null
    this.hits = []
    this.running = false
    this.skipped.clear()
  }

  /** The panel saying which space it is showing. A question asked of another
   *  space is not this space's question, and the lines it found are not in
   *  front of the reader any more. */
  forSpace(root: string | null) {
    if (this.about !== root) this.clear()
  }

  private async run() {
    const round = this.round
    const root = workspace.activeSpace?.root

    if (!root) {
      this.running = false
      return
    }

    this.hits = []
    this.skipped.clear()

    // Rows arrive in handfuls and go on the end, so the list fills from the
    // top while the rest of the space is still being read.
    await searchSpace(root, this.query, MOST, (found) => {
      if (round === this.round) this.hits = [...this.hits, ...found]
    })

    if (round === this.round) this.running = false
  }

  /** Puts the replacement into every hit that is still ticked. */
  async replace() {
    const root = workspace.activeSpace?.root
    const chosen = this.chosen
    if (!root || !chosen.length) return

    const changes = await changesFor(this.query, chosen, this.replacement, root, (path) =>
      workspace.noteText(path),
    )

    await workspace.replaceInNotes(changes)

    // The notes have changed under the list, so the list is asked again.
    this.round++
    await this.run()
  }
}

export const search = new Search()
