/** Asking the search to hold the space it is going to be asked about.
 *
 *  A search used to read the whole space per keystroke: every row out of
 *  `IndexedDB` in the browser, every file off the disk in the app. Almost none of
 *  that was the search. So both sides keep the space now, and this is the one
 *  place that says when: at the search stage of the launch, which is after the
 *  file list is on screen and after the link index has had its turn, an idle
 *  callback apart from it. See startup.svelte.ts for the order and web/space-cache.ts
 *  for what is held.
 *
 *  Only the asking is here. What is held, when it is dropped and how it is kept up
 *  to date belongs to whichever side holds it: the worker hears every row the
 *  store writes, and the crate stamps every file it read. Which is also why a
 *  space switch needs nothing said to either of them beyond this: the space being
 *  asked about is part of the question. */

import { invoke, isNative } from '../tauri'
import { startup } from '../startup.svelte'
import { isWarmth, type PapersHeld, said, type Warmth } from './warmth'

class Warm {
  /** What the search is holding, or nothing where it has not said yet. */
  private held = $state<Warmth | null>(null)
  /** Which space was asked for, so an answer about the one before it is dropped. */
  private root: string | null = null
  /** And how much of the space's papers is held. Pushed in from pdf/papers.ts,
   *  which is where a paper's words are: this is one line about what a search
   *  reads, and a paper is half of that. */
  private papers = $state<PapersHeld | null>(null)

  /** One line of diagnostics, for the panel to carry and a drive to read. */
  readonly said = $derived(said(this.held, this.papers))

  /** What the papers of the space are holding, as they change. */
  holdingPapers(held: PapersHeld) {
    this.papers = held
  }

  /** Reads a space and keeps it, when the launch says the turn has come.
   *
   *  Called where the file list lands, beside the link index's own build: a space
   *  that has just been opened is a space somebody is about to search. */
  async forSpace(root: string): Promise<void> {
    this.root = root
    this.held = null

    await startup.turn('search')
    if (this.root !== root) return

    if (!isNative) {
      const { warmSpace, whenWarmer } = await import('../web/search-client')
      whenWarmer((warmth) => {
        this.held = warmth
      })
      warmSpace(root)
      return
    }

    // The crate reads the space on a thread of its own, so this is awaited without
    // anything on screen waiting for it. A space that cannot be read is not a
    // failure to report: the next search reads what it can.
    const found = await invoke<unknown>('warm_search', { root }).catch(() => null)
    if (this.root === root && isWarmth(found)) this.held = found
  }
}

export const warm = new Warm()
