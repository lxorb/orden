import { portOf } from '@orden/contracts'
import { isDesktop, platform } from '../../platform/src/api'
import { diskPathOf } from '../../web-backend/src/api'

function explorer() {
  const port = portOf('explorer.show')
  return port.ok ? port.value : null
}

export function showLabel(
  system: string = platform(),
  ours = explorer()?.offered() ?? false,
): string {
  return system === 'macos' && !ours ? 'Show in Finder' : 'Show in folder'
}

export async function reveal(path: string, how: { system?: boolean } = {}): Promise<void> {
  if (!isDesktop || __EVEN_PLUGIN__) return

  const disk = await diskPathOf(path)
  const shows = how.system ? null : explorer()
  if (shows?.offered() && (await shows.show(disk).catch(() => false))) return
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(disk).catch(() => undefined)
}
