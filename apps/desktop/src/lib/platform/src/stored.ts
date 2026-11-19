import { log } from './log'

export function parsed(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}
export function storedText(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
export const stored = (key: string): unknown => parsed(storedText(key))
export function keep(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    lost()
    return false
  }
}
export const keepJson = (key: string, value: unknown): boolean => keep(key, JSON.stringify(value))
let told = false
function lost() {
  if (told) return
  told = true
  log('warn', 'storage would take no more, so some of what this machine knows is not kept')
}
export class Shared<T> {
  private text: string | null | undefined = undefined
  private value: T | undefined = undefined
  constructor(
    readonly key: string,
    private readonly read: (value: unknown) => T,
  ) {}
  get(): T {
    const now = storedText(this.key)
    if (this.text === undefined || now !== this.text || this.value === undefined) {
      this.text = now
      this.value = this.read(parsed(now))
    }
    return this.value
  }
  set(value: T, text: string): void {
    this.value = value
    this.text = keep(this.key, text) ? text : storedText(this.key)
  }
  drop(): void {
    this.text = undefined
    this.value = undefined
  }
}
export function heardElsewhere(keys: readonly string[], heard: (key: string | null) => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => undefined
  }
  const hear = (event: StorageEvent) => {
    if (event.key === null || keys.includes(event.key)) heard(event.key)
  }
  window.addEventListener('storage', hear)
  return () => window.removeEventListener('storage', hear)
}
export function forget(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing to do and nobody to tell.
  }
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
export function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.every((one) => typeof one === 'string') ? value : null
}
export function recordOf<T>(value: unknown, check: (one: unknown) => one is T): Record<string, T> {
  if (!isRecord(value)) return {}
  const out: Record<string, T> = {}
  for (const [key, one] of Object.entries(value)) {
    if (check(one)) out[key] = one
  }
  return out
}
export const isString = (value: unknown): value is string => typeof value === 'string'
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
