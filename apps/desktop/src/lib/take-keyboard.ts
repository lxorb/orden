import { invoke } from './platform/src/api'

export async function takeKeyboard(): Promise<void> {
  await invoke('take_keyboard').catch(() => undefined)
}
