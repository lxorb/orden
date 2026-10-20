/** Settings › General › Hardware acceleration (#550). The engine reads it before the page
 *  has run, so the crate keeps it (src-tauri/src/gpu.rs), and a change asks for a restart. */

import { key, t } from '../i18n.svelte'
import { prompt } from '../prompt.svelte'
import { invoke } from '../tauri'
import { restartToUpdate } from '../updater'

class Gpu {
  /** What the next launch starts with; asked for as the pane is drawn. */
  on = $state(true)

  async ask() {
    this.on = await invoke<boolean>('gpu_chosen')
  }

  async set(on: boolean) {
    this.on = on
    await invoke('gpu_choose', { on })
    const now = await prompt.confirm({
      title: t('Restart {name}?', { name: 'Orden' }),
      confirmLabel: key('Restart now'),
    })
    if (now) await restartToUpdate(false)
  }
}

export const gpu = new Gpu()
