import { account } from '../../accounts/src/api'
import { log, isNative } from '../../platform/src/api'
import { HANDOFF_PATH, isEmpty, isHandoff, LEGACY_WEB, unpack, WEB } from '../../handoff/src/api'
import { firstVisiting } from '../../workspace/src/api'

type FirstVisit = Awaited<ReturnType<typeof firstVisiting>>['firstVisit']

const WATCH = 500

class TakingOver {
  state = $state<'idle' | 'asking' | 'nothing'>('idle')

  private visit = $state.raw<FirstVisit | null>(null)

  constructor() {
    void firstVisiting().then((one) => (this.visit = one.firstVisit))
  }

  get offered(): boolean {
    return (
      !isNative &&
      typeof location !== 'undefined' &&
      location.origin === WEB &&
      !account.signedIn &&
      !!this.visit?.fresh
    )
  }

  bring() {
    if (this.state === 'asking') return

    const popup = window.open(
      `${LEGACY_WEB}${HANDOFF_PATH}`,
      'orden-handoff',
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
          this.visit?.answered()
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
