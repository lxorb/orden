import type { PressedKey } from '@orden/contracts'
import { isRecord } from '../../platform/src/api'
import { parseCombination, PHYSICAL, type Platform } from '../../ui-kit/src/api'

export function readPressed(value: unknown): PressedKey | null {
  if (!isRecord(value)) return null
  const { key, code, ctrl, shift, alt, meta, repeat, down } = value
  if (typeof key !== 'string' || !key || typeof code !== 'string') return null
  return {
    key,
    code,
    ctrl: ctrl === true,
    shift: shift === true,
    alt: alt === true,
    meta: meta === true,
    repeat: repeat === true,
    down: down === true,
  }
}
export interface AppKey {
  key: string
  code: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}
export interface Listed {
  readonly id: string
  readonly scope: string
  readonly run?: unknown
}
const NAMED_CODES: Record<string, string> = { ' ': 'Space', '+': 'Equal' }
const CODES: Record<string, string> = Object.fromEntries(Object.entries(PHYSICAL).map(([code, key]) => [key, code]))
const FUNCTION_KEY = /^F([1-9]|1\d|2[0-4])$/
const NAMED_KEYS = new Set([
  'Tab',
  'Enter',
  'Escape',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'ContextMenu',
])
function codeOf(key: string): string | null {
  if (FUNCTION_KEY.test(key) || NAMED_KEYS.has(key)) return key
  return NAMED_CODES[key] ?? CODES[key] ?? null
}
export function appKeyOf(text: string | null, platform: Platform): AppKey | null {
  const combination = text === null ? null : parseCombination(text, platform)
  if (!combination) return null
  const code = codeOf(combination.key)
  if (code === null) return null
  const { ctrl, shift, alt, meta, key } = combination
  if (!ctrl && !alt && !meta && !FUNCTION_KEY.test(key)) return null
  return { key, code, ctrl, shift, alt, meta }
}
export function takenByTheApp(entry: Listed): boolean {
  return (entry.scope === 'app' && entry.run !== undefined) || entry.id.startsWith('web.')
}
export function appKeys<T extends Listed>(
  entries: readonly T[],
  keyFor: (id: string) => string | null,
  offered: (entry: T) => boolean,
  platform: Platform,
): AppKey[] {
  const seen = new Set<string>()
  return entries.flatMap((entry) => {
    if (!takenByTheApp(entry) || !offered(entry)) return []
    const one = appKeyOf(keyFor(entry.id), platform)
    if (!one) return []
    const named = `${one.code}:${one.ctrl}:${one.shift}:${one.alt}:${one.meta}`
    if (seen.has(named)) return []
    seen.add(named)
    return [one]
  })
}
export function readLeft(value: unknown): { tab: string; next: boolean } | null {
  if (!isRecord(value) || typeof value.tab !== 'string' || typeof value.next !== 'boolean') return null
  return { tab: value.tab, next: value.next }
}
const TABBABLE = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
  'summary',
  '[tabindex]',
  '[contenteditable="true"]',
  '[contenteditable=""]',
].join(', ')
function follows(slot: Node, one: Node): boolean {
  return (slot.compareDocumentPosition(one) & slot.DOCUMENT_POSITION_FOLLOWING) !== 0
}
export function focusBeside(slot: HTMLElement, next: boolean): HTMLElement | null {
  const all = [...slot.ownerDocument.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (one) => one !== slot && !slot.contains(one) && one.tabIndex >= 0 && !one.closest('[inert]'),
  )
  const side = next ? all.filter((one) => follows(slot, one)) : all.filter((one) => !follows(slot, one)).reverse()
  for (const one of side) {
    one.focus({ preventScroll: true })
    if (one.ownerDocument.activeElement === one) return one
  }
  return null
}
export function cameFromAfter(slot: HTMLElement, from: EventTarget | null): boolean {
  return from !== null && 'nodeType' in from && follows(slot, from as Node)
}
