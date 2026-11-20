import { isTermTarget } from '@orden/markdown/links'
import { shownName } from '@orden/markdown/note-name'
import { termOf } from '@orden/online/term'

export function isOnlineTab(tab: { kind: string; path: string | null; doc?: string }): boolean {
  if (__EVEN_PLUGIN__ || tab.kind !== 'terminal') return false
  if (tab.path !== null) return isTermTarget(tab.path)
  return tab.doc !== undefined && termOf(tab.doc) !== null
}
export const MADE_NAME = 'Terminal'
export function termName(name: string): string {
  return shownName(name)
}
export function isMadeName(name: string): boolean {
  return new RegExp(`^${MADE_NAME}(?: \\d+)?$`, 'i').test(termName(name).trim())
}
