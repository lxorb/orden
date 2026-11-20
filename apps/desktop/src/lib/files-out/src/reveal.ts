import { portOf } from '@orden/contracts'
import { isDesktop, platform } from '../../platform/src/api'
import { diskPathOf } from '../../web-backend/src/api'

function explorer() {
  const port = portOf('explorer.show')
  return port.ok ? port.value : null
}
export const showLabel = (system: string = platform(), ours = explorer()?.offered() ?? false): string =>
  system === 'macos' && !ours ? 'Show in Finder' : 'Show in folder'
const decoded = (text: string): string => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
export function remotePath(path: string): boolean {
  const said = path.trim()
  if (/^file:/i.test(said)) {
    const rest = decoded(said.slice(5))
    const host = /^[\\/]{2}([^\\/]*)/.exec(rest)
    if (!host) return remotePath(rest)
    const name = host[1] ?? ''
    return (name !== '' && name.toLowerCase() !== 'localhost') || remotePath(rest.slice(host[0].length))
  }
  const device = /^(?:[\\/]{2}[?.]|[\\/]\?\?)[\\/](.*)$/s.exec(said)
  if (device) return !/^[a-z]:(?:[\\/]|$)/i.test(device[1] ?? '')
  return /^[\\/]{2}/.test(said)
}
export async function reveal(path: string, how: { system?: boolean } = {}): Promise<void> {
  if (!isDesktop || remotePath(path)) return
  const disk = await diskPathOf(path)
  const shows = how.system ? null : explorer()
  if (shows?.offered() && (await shows.show(disk).catch(() => false))) return
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(disk).catch(() => undefined)
}
