import { log } from './log'
import { GIVE_UP, settleUp, written } from './parting'
import { isRecord, isString } from './stored'
import { invoke } from './tauri'
import { waited } from './timing'
import type { Channel } from './updater'

function notUpdated(value: unknown): { refused: boolean; command: string | null; reason: string } {
  if (!isRecord(value)) return { refused: false, command: null, reason: String(value) }
  const { refused, command, reason } = value
  return {
    refused: refused === true,
    command: isString(command) ? command : null,
    reason: isString(reason) ? reason : 'the crate gave no reason',
  }
}

export async function updateBySystem(version: string, channel: Channel): Promise<string | null> {
  if (__EVEN_PLUGIN__ || !(await (await import('./quitting/ask')).mayStop('restart'))) return null
  try {
    await invoke('system_update', { channel, version })
  } catch (error) {
    const not = notUpdated(error)
    log('error', `update: ${not.reason}`)
    return not.refused ? null : not.command
  }
  settleUp()
  await Promise.race([written(), waited(GIVE_UP)])
  try {
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch {
    // The new version is installed either way, and the next launch is it.
  }
  return null
}
