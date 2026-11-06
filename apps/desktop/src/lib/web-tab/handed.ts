import { log } from '../log'
import { invoke } from '../tauri'
import { workspace } from '../workspace.svelte'
import { isExtensionPage, isWebAddress } from './address'

export async function hearPages(): Promise<() => void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const stop = await getCurrentWindow().listen<unknown>('nib://open-pages', (event) => {
    showPages(event.payload)
  })

  showPages(await invoke<unknown>('take_startup_pages').catch(() => []))
  return stop
}

export function showPages(said: unknown) {
  if (!Array.isArray(said)) return

  for (const url of said) {
    if (typeof url === 'string' && (isWebAddress(url) || isExtensionPage(url)))
      workspace.openPage(url, 'front')
    else log('warn', `web: a page handed over was not one: ${String(url)}`)
  }
}
