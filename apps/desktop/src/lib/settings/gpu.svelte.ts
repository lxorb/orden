import { prompt } from '../prompt.svelte'
import { invoke } from '../tauri'
import { restartToUpdate } from '../updater'

class Gpu {
  on = $state(true)

  line = $state<string | null>(null)

  async ask() {
    this.on = await invoke<boolean>('gpu_chosen')
    this.line = await invoke<string | null>('gpu_line')
  }

  async set(on: boolean) {
    this.on = on
    await invoke('gpu_choose', { on })
    const now = await prompt.confirm({
      title: `Restart Orden?`,
      confirmLabel: 'Restart now',
    })
    if (now) await restartToUpdate(false)
  }
}

export const gpu = new Gpu()
