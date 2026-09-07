/** The plugin's account of itself, gathered once and shown on request.
 *
 *  Kept apart from the bridge because it has to work when the bridge does not:
 *  nothing here waits for a phone app, and every fact it cannot get it reports
 *  as missing rather than leaving out. */

import manifest from '../../../even.app.json'
import { bridgeLike, countLaunch, type Fact, hostFacts, pageFacts } from './facts'

class Diagnosis {
  open = $state(false)
  /** Everything worth reading, in the order it is worth reading it. */
  facts = $state<Fact[]>([])

  /** Set once the bridge has finished looking, so the view can say what came of
   *  it rather than showing a blank where the answer goes. */
  private found = $state<Fact[]>([])

  toggle() {
    this.open = !this.open
  }

  /** Says what became of the wait for the phone app, and opens the view by
   *  itself when there was no phone app to find: somebody holding a plugin that
   *  does nothing should not also have to know where to tap. */
  settled(what: string, ms: number, alone: boolean) {
    this.found = [
      { name: 'bridge', value: what },
      { name: 'waited', value: `${String(Math.round(ms))} ms` },
    ]
    this.gather()
    if (alone) this.open = true
  }

  async start() {
    this.gather()

    const { before, stores } = await countLaunch()
    this.launches = [
      {
        name: 'last launch',
        value: before ? `#${String(before.count)} at ${before.at}` : 'none remembered',
      },
      ...stores,
    ]
    this.gather()
  }

  private launches = $state<Fact[]>([])

  private gather() {
    const global = globalThis as unknown as Record<string, unknown>

    this.facts = [
      { name: 'build', value: `${manifest.name} ${manifest.version}` },
      ...pageFacts(global),
      ...this.found,
      ...hostFacts(global),
      { name: 'bridge-like globals', value: bridgeLike(Object.keys(global)).join(' ') || '(none)' },
      ...this.launches,
    ]
  }
}

export const diagnosis = new Diagnosis()
