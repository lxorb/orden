import { key } from './i18n.svelte'
import { isDesktop, platform } from './tauri'

export function showLabel(system: string = platform()): string {
  return system === 'macos' ? key('Show in Finder') : key('Show in folder')
}

export async function reveal(path: string): Promise<void> {
  if (!isDesktop) return

  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(path).catch(() => undefined)
}
