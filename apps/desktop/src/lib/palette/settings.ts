import type { Field, Pane } from '../preferences'
import type { Place } from '../settings-search'
import type { Section } from '../settings.svelte'

export interface Setting {
  section: Section
  label: string
  where: string
  names: string[]
  words: string[]
  field: Field | null
  row: boolean
}

function choices(field: Field): string[] {
  return field.kind === 'select' || field.kind === 'segmented'
    ? field.options.map((one) => one.label)
    : []
}

export function settingsOf(
  panes: readonly { id: Section; label: string }[],
  generated: readonly Pane[],
  places: readonly Place[],
  settingsWord: string,
): Setting[] {
  const nameOf = (id: Section) => panes.find((one) => one.id === id)?.label ?? ''
  const rows: Setting[] = panes.map((one) => ({
    section: one.id,
    label: one.label,
    where: settingsWord,
    names: [],
    words: [],
    field: null,
    row: false,
  }))

  for (const pane of generated) {
    for (const group of pane.groups) {
      for (const field of group.fields) {
        rows.push({
          section: pane.id,
          label: field.label,
          where: pane.label,
          names: [...choices(field), ...(field.words ?? [])],
          words: [group.title].filter(Boolean),
          field,
          row: true,
        })
      }
    }
  }

  for (const place of places) {
    rows.push({
      section: place.section,
      label: place.label,
      where: nameOf(place.section),
      names: [],
      words: place.text.filter(Boolean),
      field: null,
      row: true,
    })
  }

  return rows
}

export function settingValue(field: Field | null): string | null {
  if (!field) return null

  switch (field.kind) {
    case 'select':
    case 'segmented':
    case 'swatches': {
      const held = field.get()
      return field.options.find((one) => one.value === held)?.label ?? null
    }
    case 'slider':
      return `${field.get()}${field.unit ?? ''}`
    case 'value':
      return field.get()
    case 'switch':
    case 'text':
    case 'picture':
      return null
  }
}
