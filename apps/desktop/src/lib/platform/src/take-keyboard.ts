import { invoke } from './tauri'

export async function takeKeyboard(): Promise<void> {
  await invoke('take_keyboard').catch(() => undefined)
}
