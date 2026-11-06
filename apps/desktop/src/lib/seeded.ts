import { forget, keep, storedText } from './stored'

const KEY = 'nib:seeded'

export interface Remembers {
  read(): Promise<boolean>
  write(): Promise<void>
}

let elsewhere: Remembers | null = null

export function rememberSeedIn(store: Remembers): void {
  elsewhere = store
}

export function forgetSeedStore(): void {
  elsewhere = null
}

export async function wasSeeded(): Promise<boolean> {
  if (storedText(KEY) === 'yes') return true

  try {
    return (await elsewhere?.read()) ?? false
  } catch {
    return false
  }
}

export async function markSeeded(): Promise<void> {
  keep(KEY, 'yes')
  await elsewhere?.write().catch(() => undefined)
}

const SPACE_KEY = 'nib:seed-space'

export function markSeedSpace(root: string): void {
  keep(SPACE_KEY, root)
}

export function seedSpaceRoot(): string | null {
  return storedText(SPACE_KEY)
}

export function forgetSeedSpace(): void {
  forget(SPACE_KEY)
}
