import { invoke, isDesktop, isNative, secrets } from '../../platform/src/api'
import type { Provider } from './providers'

export function keysAreGuarded(): boolean {
  return isNative
}
export async function keysInFile(): Promise<boolean> {
  if (!isDesktop) return false
  return (await invoke<unknown>('secrets_in_file').catch(() => false)) === true
}
export async function readKey(provider: Provider): Promise<string> {
  return (await read(provider.id)) ?? ''
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
  if (!trimmed) return forgetKey(id, quiet)
  await writeSecret(id, trimmed)
  if (!quiet) for (const one of moved) one()
}
export async function forgetKey(id: string, quiet = false): Promise<void> {
  await (await secrets()).forgetSecret(id)
  if (!quiet) for (const one of moved) one()
}
export async function writeSecret(id: string, secret: string): Promise<void> {
  await (await secrets()).writeSecret(id, secret)
}
export async function readSecret(id: string): Promise<string | null> {
  return (await secrets()).readSecret(id)
}
const read = readSecret
