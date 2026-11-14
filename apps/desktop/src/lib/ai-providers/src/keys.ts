import { frameWord, NoWord, isDesktop, isMobile, isNative, invoke } from '../../platform/src/api'
import type { Provider } from './providers'

interface Secrets {
  secretRead(said: string, name: string): string | null
  secretWrite(said: string, name: string, secret: string): void
  secretForget(said: string, name: string): void
}

function bridge(): Secrets | undefined {
  const found: unknown = (globalThis as { __ORDEN_SYSTEM__?: unknown }).__ORDEN_SYSTEM__
  if (typeof found !== 'object' || found === null) return undefined

  const shape = found as Partial<Secrets>
  return typeof shape.secretRead === 'function' &&
    typeof shape.secretWrite === 'function' &&
    typeof shape.secretForget === 'function'
    ? (shape as Secrets)
    : undefined
}

async function word(): Promise<string> {
  const said = await frameWord()
  if (!said) throw new NoWord()
  return said
}

export function keysAreGuarded(): boolean {
  return isNative
}

export async function keysInFile(): Promise<boolean> {
  if (!isDesktop) return false
  return (await invoke<unknown>('secrets_in_file').catch(() => false)) === true
}

export async function readKey(provider: Provider): Promise<string> {
  const found = await read(provider.id)
  return found ?? ''
}

export async function hasKey(id: string): Promise<boolean> {
  return !!(await read(id))
}

const moved = new Set<() => void>()

export function keysMoved(listener: () => void): () => void {
  moved.add(listener)
  return () => moved.delete(listener)
}

export async function writeKey(id: string, secret: string, quiet = false): Promise<void> {
  const trimmed = secret.trim()
  if (!trimmed) {
    await forgetKey(id, quiet)
    return
  }

  await writeSecret(id, trimmed)
  if (!quiet) for (const one of moved) one()
}

export async function forgetKey(id: string, quiet = false): Promise<void> {
  const phone = isMobile ? bridge() : undefined
  if (phone) phone.secretForget(await word(), id)
  else await invoke<null>('secret_forget', { name: id })
  if (!quiet) for (const one of moved) one()
}

export async function writeSecret(id: string, secret: string): Promise<void> {
  const phone = isMobile ? bridge() : undefined
  if (phone) phone.secretWrite(await word(), id, secret)
  else await invoke<null>('secret_write', { name: id, secret })
}

export function readSecret(id: string): Promise<string | null> {
  return read(id)
}

async function read(id: string): Promise<string | null> {
  const phone = isMobile ? bridge() : undefined
  const found: unknown = phone
    ? phone.secretRead(await word(), id)
    : await invoke<unknown>('secret_read', { name: id })
  return typeof found === 'string' && found ? found : null
}
