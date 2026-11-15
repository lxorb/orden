import { isScheme, type Scheme } from '@orden/contracts'
import { isRecord, isString } from '../../platform/src/api'

export const STYLE_ID = 'orden-user-theme'
export const CUSTOM_ID = 'orden-custom-css'

export interface Dressed {
  scheme: Scheme
  sheet: string
  custom: string
  tokens: Record<string, string>
}

export function isDressed(value: unknown): value is Dressed {
  if (!isRecord(value) || !isScheme(value.scheme)) return false
  if (!isString(value.sheet) || !isString(value.custom) || !isRecord(value.tokens)) return false
  return Object.entries(value.tokens).every(
    ([token, one]) => token.startsWith('--') && isString(one),
  )
}

export function sheetAs(id: string, css: string, before: string | null = null): void {
  let style = document.getElementById(id)
  if (!css) {
    style?.remove()
    return
  }
  if (!style) {
    style = document.createElement('style')
    style.id = id
    document.head.insertBefore(style, before === null ? null : document.getElementById(before))
  }
  style.textContent = css
}

let worn: string[] = []

export function dressAs(dressed: Dressed): void {
  const root = document.documentElement
  root.dataset.theme = dressed.scheme
  sheetAs(CUSTOM_ID, dressed.custom)
  sheetAs(STYLE_ID, dressed.sheet, CUSTOM_ID)
  for (const token of worn) root.style.removeProperty(token)
  for (const [token, value] of Object.entries(dressed.tokens)) root.style.setProperty(token, value)
  worn = Object.keys(dressed.tokens)
}
