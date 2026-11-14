import '../../theme-ports'
import { account } from '../../account.svelte'
import { collectErrors } from '../../log'
import { reloading } from '../../reloading.svelte'
import { settings } from '../../settings.svelte'
import { shortcuts } from '../../shortcuts.svelte'
import { hub } from '../../sync-client/src/api'
import { theme } from '../../theme/src/api'
import { viewport } from '../../viewport.svelte'
import { pass } from '../store.svelte'
import { startPassSync } from '../syncing.svelte'

export function startPassWeb(): () => void {
  collectErrors()
  viewport.start()
  theme.init()
  void import('../../theme-looks/src/api').then((one) => one.syncLook())
  shortcuts.restore()
  settings.restore()
  void account.restore()
  startPassSync()
  const stopReloading = reloading.watch(() => pass.exclusive(() => Promise.resolve(true)))
  const stopHub = hub.start()
  return () => {
    stopReloading()
    stopHub()
  }
}
