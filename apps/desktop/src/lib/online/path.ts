import { isTermTarget } from '@orden/markdown/links'
import { termOf } from '@orden/online/term'

const TERM = /\.term$/i

export function isOnlineTab(tab: { kind: string; path: string | null; doc?: string }): boolean {
  if (__EVEN_PLUGIN__ || tab.kind !== 'terminal') return false
  if (tab.path !== null) return isTermTarget(tab.path)
  return tab.doc !== undefined && termOf(tab.doc) !== null
}

export const MADE_NAME = 'Terminal'

export function termName(name: string): string {
  return name.replace(TERM, '') || name
}

export function isMadeName(name: string): boolean {
  return new RegExp(`^${MADE_NAME}(?: \\d+)?$`, 'i').test(termName(name).trim())
}
