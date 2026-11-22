import { frameWord, method, NoWord } from './mobile-bridge'
import { invoke, isMobile, isNative } from './tauri'

async function word(): Promise<string> {
  const said = await frameWord()
  if (!said) throw new NoWord()
  return said
}
export const secretsGuarded = (): boolean => isNative
export async function readSecret(name: string): Promise<string | null> {
  const read = isMobile ? method('secretRead') : undefined
  const found: unknown = read ? read(await word(), name) : await invoke<unknown>('secret_read', { name })
  return typeof found === 'string' && found ? found : null
}
export async function writeSecret(name: string, secret: string): Promise<void> {
  const write = isMobile ? method('secretWrite') : undefined
  if (write) write(await word(), name, secret)
  else await invoke<null>('secret_write', { name, secret })
}
export async function forgetSecret(name: string): Promise<void> {
  const forget = isMobile ? method('secretForget') : undefined
  if (forget) forget(await word(), name)
  else await invoke<null>('secret_forget', { name })
}
