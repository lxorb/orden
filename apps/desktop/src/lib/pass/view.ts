import { isRecord } from '../platform/src/api'
import type { Scope, Sort, TypeFilter } from './list'
import { SORTS, TYPE_FILTERS } from './list'

const PAGES = ['items', 'monitor', 'settings', 'links'] as const
export type Page = (typeof PAGES)[number]

export const SETTINGS_TABS = ['general', 'security', 'aliases', 'import', 'export'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

export interface PassView {
  scope: Scope
  filter: TypeFilter
  sort: Sort
  item: string | null
  page: Page
  settingsTab: SettingsTab
}

export const FIRST_VIEW: PassView = {
  scope: { kind: 'all' },
  filter: 'all',
  sort: 'recent',
  item: null,
  page: 'items',
  settingsTab: 'general',
}

function oneOf<T>(words: readonly T[], value: unknown, fallback: T): T {
  return words.includes(value as T) ? (value as T) : fallback
}

function scopeIn(value: unknown): Scope {
  if (!isRecord(value)) return FIRST_VIEW.scope
  switch (value.kind) {
    case 'trash':
    case 'shared-with-me':
    case 'shared-by-me':
      return { kind: value.kind }
    case 'vault':
      return typeof value.vault === 'string'
        ? {
            kind: 'vault',
            vault: value.vault,
            folder: typeof value.folder === 'string' ? value.folder : null,
          }
        : FIRST_VIEW.scope
    default:
      return FIRST_VIEW.scope
  }
}

export function viewIn(text: string): PassView {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return FIRST_VIEW
  }
  if (!isRecord(value)) return FIRST_VIEW
  return {
    scope: scopeIn(value.scope),
    filter: oneOf(TYPE_FILTERS, value.filter, FIRST_VIEW.filter),
    sort: oneOf(SORTS, value.sort, FIRST_VIEW.sort),
    item: typeof value.item === 'string' ? value.item : null,
    page: oneOf(PAGES, value.page, FIRST_VIEW.page),
    settingsTab: oneOf(SETTINGS_TABS, value.settingsTab, FIRST_VIEW.settingsTab),
  }
}

export function writeView(view: PassView): string {
  return JSON.stringify(view)
}
