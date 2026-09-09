/** Work that takes long enough to be worth saying so.
 *
 *  Exporting a note, importing a document, storing a pasted picture: each is a
 *  round trip and a render, and until it comes back nothing on screen has
 *  changed. A line across the top of the document is the whole report - it says
 *  something is happening without saying what, which is all anyone needs while
 *  they wait, and it does not take a corner of the window for itself the way a
 *  spinner would.
 *
 *  Counted rather than flagged, so two exports at once do not turn the line off
 *  when the first finishes.
 *
 *  The same line says when something did not work. Work that fails silently and
 *  carries on some other way is the worst of both: the wait happened, the result
 *  is not what was asked for, and nothing on screen says so. */

/** How long the line stays once it has something to say. Long enough to read a
 *  sentence, short enough that it is gone before it is in the way. */
const TROUBLE_SHOWN = 5000

class Busy {
  private depth = $state(0)
  /** What is going on, for anyone reading the screen rather than looking at it. */
  label = $state<string | null>(null)

  /** What did not work, in a sentence, or null while nothing has gone wrong.
   *  The line wears it instead of sweeping. */
  trouble = $state<string | null>(null)
  private clearing: ReturnType<typeof setTimeout> | undefined

  get active(): boolean {
    return this.depth > 0
  }

  /** Runs `work`, with the line on while it does. The line goes off however
   *  `work` ends, so a failed export does not leave it running. */
  async run<T>(label: string, work: () => Promise<T>): Promise<T> {
    // A fresh job clears what the last one had to say: a sentence about an export
    // from a minute ago over the top of one running now is a sentence about the
    // wrong thing.
    if (this.depth === 0) this.clear()
    this.depth += 1
    this.label = label

    try {
      return await work()
    } finally {
      this.depth -= 1
      if (this.depth === 0) this.label = null
    }
  }

  /** Something the work could not do. The line stops sweeping and says this
   *  instead, for a moment; work that goes on to try another way says so here
   *  rather than changing course without a word. */
  failed(reason: string) {
    this.trouble = reason
    clearTimeout(this.clearing)
    this.clearing = setTimeout(() => {
      this.trouble = null
    }, TROUBLE_SHOWN)
  }

  /** Nothing to say any more. */
  clear() {
    clearTimeout(this.clearing)
    this.trouble = null
  }

  /** The same for work that is started and not waited on. */
  start(label: string, work: () => Promise<unknown>) {
    void this.run(label, work).catch(() => undefined)
  }
}

export const busy = new Busy()
