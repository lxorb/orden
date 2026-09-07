/** The plugin's account of itself, gathered once and shown on request.
 *
 *  Kept apart from the bridge because it has to work when the bridge does not:
 *  nothing here waits for a phone app, and every fact it cannot get it reports
 *  as missing rather than leaving out. */

import manifest from '../../../even.app.json'
import { bridgeLike, countLaunch, type Fact, hostFacts, pageFacts } from './facts'
import { read, wrote } from './keep'

class Diagnosis {
  /** Open from the first paint, and stays open until somebody closes it.
   *
   *  It used to wait for the bridge to give up before showing itself, which
   *  meant the one build where nothing worked at all was also the one build
   *  that said nothing. A panel that has to be earned is no use: this is the
   *  plugin's only voice on a device, so it speaks first and is dismissed
   *  second. */
  open = $state(true)
  /** Everything worth reading, in the order it is worth reading it. */
  facts = $state<Fact[]>([])

  constructor() {
    // Filled in here rather than waiting to be started, so that a launch which
    // falls over before anything else runs still says which build fell over.
    this.gather()
  }

  /** Set once the bridge has finished looking, so the view can say what came of
   *  it rather than showing a blank where the answer goes. */
  private found = $state<Fact[]>([])

  toggle() {
    this.open = !this.open
  }

  /** Says what became of the wait for the phone app. The view is already open;
   *  this only fills in the answer when it arrives. */
  settled(what: string, ms: number) {
    this.found = [
      { name: 'bridge', value: what },
      { name: 'waited', value: `${String(Math.round(ms))} ms` },
    ]
    this.gather()
  }

  /** How long the panel keeps catching up with itself, and how often.
   *
   *  The stores answer over the seconds after a launch and the sign-in writes
   *  later still, so a panel gathered once shows the questions rather than the
   *  answers. Half a minute covers a launch; after that nothing new arrives. */
  private static readonly WATCH = 30_000
  private static readonly TICK = 1000

  async start() {
    this.gather()

    const until = Date.now() + Diagnosis.WATCH
    const ticking = setInterval(() => {
      this.gather()
      if (Date.now() >= until) clearInterval(ticking)
    }, Diagnosis.TICK)

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

  /** What each store did with the token, this launch. The read is from startup
   *  and the write from the last sign-in, so one screenshot on the launch after
   *  a sign-in says which store kept it and which lost it. */
  private token(): Fact[] {
    const lines: Fact[] = []
    for (const [name, what] of read) lines.push({ name: `read ${name}`, value: what })
    for (const [name, what] of wrote) lines.push({ name: `wrote ${name}`, value: what })

    return lines.length ? lines : [{ name: 'token', value: 'no store asked yet' }]
  }

  private gather() {
    const global = globalThis as unknown as Record<string, unknown>

    this.facts = [
      // First line, and the one that answers "did the build I just shipped
      // reach the phone at all": version, commit, and when it was built.
      { name: 'build', value: `${manifest.name} ${__EVEN_BUILD__}` },
      ...pageFacts(global),
      ...this.found,
      ...hostFacts(global),
      { name: 'bridge-like globals', value: bridgeLike(Object.keys(global)).join(' ') || '(none)' },
      ...this.launches,
      ...this.token(),
    ]
  }
}

export const diagnosis = new Diagnosis()
