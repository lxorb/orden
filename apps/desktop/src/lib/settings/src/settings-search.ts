import type { SettingsSectionId } from '@orden/contracts'
import type { Field, Group, Pane } from './preferences'

export interface Place {
  section: SettingsSectionId
  label: string
  text: string[]
}

export type Hit =
  | { kind: 'field'; section: SettingsSectionId; pane: Pane; group: Group; field: Field }
  | { kind: 'place'; section: SettingsSectionId; label: string }

export function search(query: string, panes: Pane[], places: Place[]): Hit[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const has = (text: string) => text.toLowerCase().includes(needle)
  const hits: Hit[] = []

  for (const pane of panes) {
    for (const group of pane.groups) {
      for (const field of group.fields) {
        if (field.shown?.() !== false && words(field, group, pane).some(has)) {
          hits.push({ kind: 'field', section: pane.id, pane, group, field })
        }
      }
    }
  }

  for (const place of places) {
    if ([place.label, ...place.text].some(has)) {
      hits.push({ kind: 'place', section: place.section, label: place.label })
    }
  }

  return hits
}

function words(field: Field, group: Group, pane: Pane): string[] {
  const own =
    field.kind === 'select' || field.kind === 'segmented' || field.kind === 'swatches'
      ? field.options.map((option) => option.label)
      : field.kind === 'slider' && field.unit
        ? [field.unit]
        : []

  return [field.label, group.title, pane.label, ...(field.hint ? [field.hint] : []), ...own, ...(field.words ?? [])]
}
