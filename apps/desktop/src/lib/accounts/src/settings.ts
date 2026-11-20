import { hearSettings as heard, heardSettings } from './account-owed'
import { request } from './client'
import type { AccountSettings, KeyState } from './routes'
import { isRecord, merged } from '../../platform/src/api'

type Name = keyof AccountSettings
const said = (value: unknown) => JSON.stringify(value)
const shaped = (value: unknown) => Array.isArray(value) || isRecord(value)
export function settingMerged(name: Name, base: unknown, mine: unknown, theirs: unknown): unknown {
  const read = (value: unknown) => (name === 'hiddenKinds' && value === null ? [] : value)
  const [was, now, held] = [read(base), read(mine), read(theirs)]
  if (said(held) === said(was)) return mine
  const empty = Array.isArray(now) ? [] : isRecord(now) ? {} : undefined
  return merged(now, was ?? empty, held ?? empty)
}
export async function readSettings(token: string): Promise<{ settings: AccountSettings; key?: KeyState }> {
  const answer = await request<{ settings: AccountSettings; key?: KeyState }>('/v1/settings', { token })
  heard(answer.settings)
  return answer
}
export async function saveSettings(
  token: string,
  patch: AccountSettings,
  base: AccountSettings | undefined = heardSettings(),
): Promise<{ settings: AccountSettings }> {
  const was = (name: Name): unknown => base?.[name]
  const changed = (Object.keys(patch) as Name[]).filter((name) => !base || said(patch[name]) !== said(was(name)))
  if (!changed.length) return { settings: heardSettings() ?? base ?? {} }
  let sending: Record<string, unknown> = Object.fromEntries(changed.map((name) => [name, patch[name]]))
  let theirs: AccountSettings | null = null
  if (changed.some((name) => shaped(patch[name]) || shaped(was(name)))) {
    const held = (await readSettings(token)).settings
    theirs = held
    sending = Object.fromEntries(
      changed
        .map((name) => [name, settingMerged(name, was(name), patch[name], held[name])] as const)
        .filter(([name, value]) => said(value) !== said(held[name])),
    )
  }
  if (!Object.keys(sending).length) return { settings: theirs ?? heardSettings() ?? base ?? {} }
  const answer = await request<{ settings: AccountSettings }>('/v1/settings', {
    method: 'PATCH',
    token,
    body: sending,
  })
  heard(answer.settings)
  return answer
}
