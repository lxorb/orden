import { discard } from './updater'
import { invoke, isDesktop, platform } from './tauri'

let asked: Promise<boolean> | null = null

export function stuck(): Promise<boolean> {
  asked ??=
    isDesktop && platform() === 'macos'
      ? invoke<boolean>('app_stuck').catch(() => false)
      : Promise.resolve(false)
  return asked
}

export async function moveToApplications() {
  await discard()
  await invoke('move_to_applications')
}
