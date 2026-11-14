import type { PaletteSetting, PaletteSettings } from '@orden/contracts'
import { EditorView } from '@orden/editor'
import { type Section, settings } from '../../settings.svelte'
import type { Field, Pane } from './fields'
import { landing } from './landing.svelte'
import { places } from './places'
import { preferences } from './preferences'
import { ICONS, sectionGroups } from './sections'
import type { Place } from './settings-search'

function choices(field: Field): string[] {
  return field.kind === 'select' || field.kind === 'segmented'
    ? field.options.map((one) => one.label)
    : []
}

function fieldValue(field: Field): string | null {
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

function pressOf(field: Field): (() => void) | null {
  if (field.kind === 'switch') return () => field.set(!field.get())
  if (field.kind === 'value') return () => field.press()
  return null
}

function plain(
  section: Section,
  label: string,
  where: string,
  words: string[],
  row: boolean,
): PaletteSetting {
  return {
    section,
    label,
    where,
    names: [],
    words,
    row,
    icon: ICONS[section] ?? '',
    switched: () => null,
    value: () => null,
    press: null,
  }
}

export function settingRows(
  panes: readonly { id: Section; label: string }[],
  generated: readonly Pane[],
  places: readonly Place[],
  settingsWord: string,
): PaletteSetting[] {
  const nameOf = (id: Section) => panes.find((one) => one.id === id)?.label ?? ''
  const rows = panes.map((one) => plain(one.id, one.label, settingsWord, [], false))

  for (const pane of generated) {
    for (const group of pane.groups) {
      for (const field of group.fields) {
        rows.push({
          ...plain(pane.id, field.label, pane.label, [group.title].filter(Boolean), true),
          names: [...choices(field), ...(field.words ?? [])],
          switched: () => (field.kind === 'switch' ? field.get() : null),
          value: () => fieldValue(field),
          press: pressOf(field),
        })
      }
    }
  }

  for (const place of places) {
    rows.push(
      plain(place.section, place.label, nameOf(place.section), place.text.filter(Boolean), true),
    )
  }

  return rows
}

export const paletteSettings: PaletteSettings = {
  rows: (view) =>
    settingRows(
      sectionGroups().flat(),
      preferences(view instanceof EditorView ? view : undefined),
      places(),
      'Settings',
    ),
  show: (section, label) => {
    settings.show(section)
    landing.label = label
  },
}
