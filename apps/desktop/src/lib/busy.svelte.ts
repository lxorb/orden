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
 *  when the first finishes. */

class Busy {
  private depth = $state(0)
  /** What is going on, for anyone reading the screen rather than looking at it. */
  label = $state<string | null>(null)

  get active(): boolean {
    return this.depth > 0
  }

  /** Runs `work`, with the line on while it does. The line goes off however
   *  `work` ends, so a failed export does not leave it running. */
  async run<T>(label: string, work: () => Promise<T>): Promise<T> {
    this.depth += 1
    this.label = label

    try {
      return await work()
    } finally {
      this.depth -= 1
      if (this.depth === 0) this.label = null
    }
  }

  /** The same for work that is started and not waited on. */
  start(label: string, work: () => Promise<unknown>) {
    void this.run(label, work).catch(() => undefined)
  }
}

export const busy = new Busy()
