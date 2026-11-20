import './lib/backend-ports'
import { isEmpty, LEGACY_WEBS, pack, WEB } from './lib/handoff/src/api'

const LINGER = 200
const opener = window.opener as Window | null
if (opener && LEGACY_WEBS.includes(location.origin)) {
  void pack().then(
    (handoff) => {
      opener.postMessage(handoff, WEB)
      if (!isEmpty(handoff)) setTimeout(() => window.close(), LINGER)
    },
    () => window.close(),
  )
}
