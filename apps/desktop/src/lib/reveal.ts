import { key } from './i18n.svelte'
import { isDesktop, platform } from './tauri'

export function showLabel(system: string = platform()): string {
  return system === 'macos' ? key('Show in Finder') : key('Show in folder')
}

export async function reveal(path: string): Promise<void> {
  if (!isDesktop || __EVEN_PLUGIN__) return

  const [{ revealItemInDir }, { diskPathOf }] = await Promise.all([
    import('@tauri-apps/plugin-opener'),
    import('./internal/work'),
  ])
  await revealItemInDir(await diskPathOf(path)).catch(() => undefined)
}
