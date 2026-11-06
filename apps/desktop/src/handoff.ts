import { LEGACY_WEB, pack, WEB } from './lib/web/handoff'

const LINGER = 200

const opener = window.opener as Window | null

if (opener && location.origin === LEGACY_WEB) {
  void pack()
    .then((handoff) => opener.postMessage(handoff, WEB))
    .finally(() => setTimeout(() => window.close(), LINGER))
}
