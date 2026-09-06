import { stageUpdate } from './updater'

/** The notice that offers a downloaded update.
 *
 *  Nothing here installs anything: `updater.ts` downloads in the background and
 *  puts the new version in place as the app closes, so the update arrives on
 *  its own. This is only the offer to get there sooner, and dismissing it costs
 *  nothing - what was downloaded is still installed on the way out. */
class Updates {
  /** The version waiting to be installed, once one has been downloaded. Null
   *  when there is nothing new, which is most of the time. */
  ready = $state<string | null>(null)

  /** Asked once at startup, quietly: a machine with no network simply has no
   *  update to offer. */
  async check() {
    this.ready = await stageUpdate()
  }

  dismiss() {
    this.ready = null
  }
}

export const updates = new Updates()
