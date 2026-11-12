import { ACCENTS } from './accents'
import { CONTENT_INITIAL, CONTENT_LEVELS, type ContentLevel } from './content-ground'
import type { ThemeSetting } from './themes/settings'

const NAMES: Record<ContentLevel, string> = {
  opaque: 'Opaque',
  tinted: 'Tinted',
  clear: 'See-through',
}

export function contentSetting(): ThemeSetting {
  return {
    id: 'content',
    label: 'Content',
    hint: 'How much of what is behind the window shows under notes and terminals; the words always stay readable.',
    own: true,
    kind: 'choice',
    options: CONTENT_LEVELS.map((value) => ({ value, label: NAMES[value] })),
    initial: CONTENT_INITIAL,
    paint: () => ({}),
  }
}

export function contentOf(value: unknown): ContentLevel {
  return CONTENT_LEVELS.find((one) => one === value) ?? CONTENT_INITIAL
}

export function rangeSetting(
  id: string,
  label: string,
  hint: string,
  min: number,
  max: number,
  initial: number,
  unit: string,
): ThemeSetting & { kind: 'range' } {
  return {
    id,
    label,
    hint,
    own: true,
    kind: 'range',
    min,
    max,
    step: 1,
    unit,
    initial,
    paint: () => ({}),
  }
}

export const ACCENT_SWATCH = 'accent'

export function tintColourSetting(id: string, when: () => boolean): ThemeSetting {
  return {
    id,
    label: 'Tint colour',
    hint: 'The colour laid over the picture.',
    own: true,
    kind: 'colour',
    initial: ACCENT_SWATCH,
    options: [
      { value: ACCENT_SWATCH, name: 'Accent', dark: 'var(--accent)', light: 'var(--accent)' },
      ...ACCENTS.map((one) => ({
        value: one.id,
        name: one.name,
        dark: one.dark,
        light: one.light,
      })),
    ],
    when,
    paint: () => ({}),
  }
}
