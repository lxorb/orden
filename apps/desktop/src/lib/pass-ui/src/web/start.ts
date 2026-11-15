import '../../../theme-ports'
import { account } from '../../../accounts/src/api'
import { collectErrors } from '../../../platform/src/api'
import { choices } from '../../../modes/src/api'
import { connectors } from '../../../connectors.svelte'
import { shortcuts } from '../../../shortcuts/src/api'
import { hub } from '../../../sync-client/src/api'
import { theme } from '../../../theme/src/api'
import { reloading, viewport } from '../../../ui-kit/src/api'
import { pass, startPassSync } from '../../../pass-sync/src/api'

export function startPassWeb(): () => void {
  collectErrors()
  viewport.start()
  theme.init()
  void import('../../../theme-looks/src/api').then((one) => one.syncLook())
  shortcuts.restore()
  connectors.restore()
  choices.restore()
  void account.restore()
  startPassSync()
  const stopReloading = reloading.watch(() => pass.exclusive(() => Promise.resolve(true)))
  const stopHub = hub.start()
  return () => {
    stopReloading()
    stopHub()
  }
}
