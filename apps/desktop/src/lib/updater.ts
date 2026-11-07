import { log } from './log'
import { GIVE_UP, settleUp, written } from './parting'
import { isNumber, isRecord, isString } from './stored'
import { invoke, isDesktop, isNative } from './tauri'
import { waited } from './timing'

const CHANNELS = ['stable', 'unstable'] as const
export type Channel = (typeof CHANNELS)[number]

export function asChannel(value: unknown): Channel {
  return CHANNELS.find((one) => one === value) ?? 'stable'
}

export const webChannel: Channel | null =
  isNative || __EVEN_PLUGIN__
    ? null
    : import.meta.env.VITE_ORDEN_CHANNEL === 'unstable'
      ? 'unstable'
      : 'stable'

export function switchWebChannel(to: Channel): void {
  if (to === webChannel) return
  location.href = `?channel=${to}`
}

let staged: { version: string; install(): Promise<void>; close(): Promise<void> } | null = null

export const ready = () => staged !== null

export const stagedVersion = () => staged?.version ?? null

let keeper: Promise<string | null> | null = null

export function managedBy(): Promise<string | null> {
  keeper ??= invoke<string | null>('install_manager').then(
    (name) => name ?? null,
    () => null,
  )
  return keeper
}

const SYSTEM = new Set(['apt', 'dnf'])

export const updatedBySystem = (manager: string | null) => manager !== null && SYSTEM.has(manager)

let announced: string | null = null

export const announcedVersion = () => announced

interface Found {
  rid: number
  currentVersion: string
  version: string
  rawJson: Record<string, unknown>
}

function found(value: unknown): Found | null {
  if (!isRecord(value)) return null

  const { rid, currentVersion, version, rawJson } = value
  if (!isNumber(rid) || !isString(currentVersion) || !isString(version)) return null
  if (!isRecord(rawJson)) return null

  return { rid, currentVersion, version, rawJson }
}

export async function stageUpdate(channel: Channel): Promise<string | null> {
  if (__EVEN_PLUGIN__ || !isDesktop || staged) return null

  try {
    const one = found(await invoke<unknown>('check_update', { channel }))
    if (!one) return null

    const { Update } = await import('@tauri-apps/plugin-updater')
    const update = new Update(one)

    if (await managedBy()) {
      void update.close().catch(() => undefined)
      if (update.version === announced) return null
      announced = update.version
      return update.version
    }

    await update.download()
    staged = update
    return update.version
  } catch {
    return null
  }
}

export async function discard() {
  const going = staged
  staged = null
  announced = null

  try {
    await going?.close()
  } catch {
    // Nothing to say: it is not being installed either way, and whatever the
    // crate is still holding goes with the process.
  }
}

export async function restartToUpdate(install = true) {
  if (!__EVEN_PLUGIN__ && !(await (await import('./quitting/ask')).mayStop('restart'))) return
  settleUp()
  await Promise.race([written(), waited(GIVE_UP)])
  if (install && !(await installStaged())) return

  try {
    await invoke('crash_leaving').catch(() => undefined)
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch {
    // Nothing sensible to do: the update is installed either way, and the next
    // launch picks it up.
  }
}

export async function installStaged(closing = false): Promise<boolean> {
  if (!staged) return false
  if (!(await invoke<boolean>('update_may_install', { closing }).catch(() => true))) {
    if (closing) handOn()
    return false
  }

  try {
    await invoke('crash_leaving').catch(() => undefined)
    await staged.install()
    return true
  } catch (error) {
    log('error', `update: ${error instanceof Error ? error.message : String(error)}`)
    void invoke('update_install_failed').catch(() => undefined)
    return false
  } finally {
    staged = null
  }
}

const HANDING = 'nib:update-handed'

function handOn() {
  const channel = new BroadcastChannel(HANDING)
  channel.postMessage(null)
  channel.close()
}

export function hearHandedOn(look: () => void): () => void {
  const channel = new BroadcastChannel(HANDING)
  channel.onmessage = () => look()
  return () => channel.close()
}

export async function settledForInstaller(owed: () => Promise<unknown>): Promise<void> {
  await Promise.race([owed().catch(() => undefined), waited(GIVE_UP)])
  await invoke('update_settled').catch(() => undefined)
}
