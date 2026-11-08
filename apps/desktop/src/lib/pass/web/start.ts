import { account } from '../../account.svelte'
import { i18n } from '../../i18n.svelte'
import { collectErrors } from '../../log'
import { reloading } from '../../reloading.svelte'
import { settings } from '../../settings.svelte'
import { shortcuts } from '../../shortcuts.svelte'
import { hub } from '../../sync2/hub.svelte'
import { theme } from '../../theme.svelte'
import { viewport } from '../../viewport.svelte'
import { pass } from '../store.svelte'
import { startPassSync } from '../syncing.svelte'

export function startPassWeb(): () => void {
  collectErrors()
  viewport.start()
  i18n.restore()
  theme.init()
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
