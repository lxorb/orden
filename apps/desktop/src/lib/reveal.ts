import { hiddenKinds } from './settings.svelte'
import { isDesktop, platform } from './platform/src/api'

function explorerReveals(): boolean {
  return hiddenKinds.offers('explorer')
}

export function showLabel(system: string = platform(), ours = explorerReveals()): string {
  return system === 'macos' && !ours ? 'Show in Finder' : 'Show in folder'
}

export async function reveal(path: string, how: { system?: boolean } = {}): Promise<void> {
  if (!isDesktop || __EVEN_PLUGIN__) return

  const { diskPathOf } = await import('./internal/work')
  const disk = await diskPathOf(path)
  if (!how.system && explorerReveals()) {
    const { showInExplorer } = await import('./explorer/reveal')
    if (await showInExplorer(disk).catch(() => false)) return
  }
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(disk).catch(() => undefined)
}
