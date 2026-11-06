import { account } from '../account.svelte'
import { firstVisit } from '../first-visit.svelte'
import { log } from '../log'
import { isNative } from '../tauri'
import { HANDOFF_PATH, isEmpty, isHandoff, LEGACY_WEB, unpack, WEB } from './handoff'

const WATCH = 500

class TakingOver {
  state = $state<'idle' | 'asking' | 'nothing'>('idle')

  get offered(): boolean {
    return (
      !isNative &&
      typeof location !== 'undefined' &&
      location.origin === WEB &&
      !account.signedIn &&
      firstVisit.fresh
    )
  }

  bring() {
    if (this.state === 'asking') return

    const popup = window.open(
      `${LEGACY_WEB}${HANDOFF_PATH}`,
      'nib-handoff',
      'popup,width=420,height=320',
    )
    if (!popup) return
    this.state = 'asking'

    const stop = () => {
      window.removeEventListener('message', heard)
      clearInterval(watching)
    }

    const heard = (event: MessageEvent) => {
      if (event.origin !== LEGACY_WEB || event.source !== popup || !isHandoff(event.data)) return
      stop()
      const handoff = event.data
      if (isEmpty(handoff)) {
        this.state = 'nothing'
        return
      }
      if (!this.offered) {
        this.state = 'idle'
        return
      }
      unpack(handoff)
        .then(() => {
          firstVisit.answered()
          location.reload()
        })
        .catch((error: unknown) => {
          log('warn', `the notes from the old address could not be written here: ${String(error)}`)
          this.state = 'idle'
        })
    }

    let closedOnce = false
    const watching = setInterval(() => {
      if (!popup.closed || this.state !== 'asking') return
      if (!closedOnce) {
        closedOnce = true
        return
      }
      stop()
      this.state = 'idle'
    }, WATCH)

    window.addEventListener('message', heard)
  }
}

export const takingOver = new TakingOver()
