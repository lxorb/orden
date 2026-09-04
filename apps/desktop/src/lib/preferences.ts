import type { EditorView } from '@nib/editor'
import { CODE_PALETTES } from '@nib/editor'
import { i18n, LANGUAGES, t } from './i18n.svelte'
import { modes } from './modes.svelte'
import { theme } from './theme.svelte'
import { workspace } from './workspace.svelte'

/** One control, and how to read and write whatever sits behind it. A field
 *  that says what it starts as can be put back to that; a pane whose fields
 *  all can offers a reset. */
export type Field =
  | { kind: 'switch'; label: string; initial?: boolean; get(): boolean; set(on: boolean): void }
  | {
      kind: 'slider'
      label: string
      min: number
      max: number
      step: number
      unit?: string
      initial?: number
      get(): number
      set(value: number): void
    }
  | {
      kind: 'select'
      label: string
      options: { value: string; label: string }[]
      initial?: string
      get(): string
      set(value: string): void
    }

export interface Group {
  title: string
  fields: Field[]
}

/** The panes that are only about settings. Account, publishing and the LLM
 *  connector are their own thing and stay written out by hand. */
export type PaneId = 'general' | 'editor' | 'markdown' | 'appearance'

export interface Pane {
  id: PaneId
  label: string
  groups: Group[]
}

/** Built against a live view so a change lands in the editor on screen. */
export function preferences(view?: EditorView): Pane[] {
  return [
    {
      id: 'general',
      label: t('General'),
      groups: [
        {
          title: t('Saving'),
          fields: [
            {
              kind: 'switch',
              label: t('Save as I type'),
              get: () => workspace.autoSave,
              set: (on) => workspace.setAutoSave(on),
            },
            {
              kind: 'slider',
              label: t('Wait before saving'),
              min: 400,
              max: 5000,
              step: 200,
              unit: 'ms',
              get: () => workspace.autoSaveDelay,
              set: (value) => workspace.setAutoSaveDelay(value),
            },
          ],
        },
        {
          title: t('Language'),
          fields: [
            {
              kind: 'select',
              label: t('Language'),
              options: LANGUAGES.map((one) => ({ value: one.id, label: t(one.name) })),
              get: () => i18n.choice,
              set: (value) => i18n.select(value),
            },
          ],
        },
      ],
    },

    {
      id: 'editor',
      label: t('Editor'),
      groups: [
        {
          title: t('Text'),
          fields: [
            {
              kind: 'slider',
              label: t('Text size'),
              min: 0.8,
              max: 1.6,
              step: 0.05,
              unit: '×',
              initial: 1,
              get: () => modes.zoom,
              set: (value) => modes.setZoom(value),
            },
            {
              kind: 'slider',
              label: t('Line spacing'),
              min: 1.3,
              max: 2.2,
              step: 0.02,
              initial: 1.72,
              get: () => modes.lineHeight,
              set: (value) => modes.setLineSpacing(value, view),
            },
            {
              kind: 'slider',
              label: t('Line width'),
              min: 30,
              max: 70,
              step: 1,
              unit: 'rem',
              initial: 42,
              get: () => modes.width,
              set: (value) => modes.setWidth(value, view),
            },
          ],
        },
        {
          title: t('Writing'),
          fields: [
            {
              kind: 'switch',
              label: t('Close brackets and quotes'),
              initial: true,
              get: () => modes.closeBrackets,
              set: () => modes.toggleCloseBrackets(view),
            },
            {
              kind: 'switch',
              label: t('Check spelling'),
              initial: true,
              get: () => modes.spellcheck,
              set: () => modes.toggleSpellcheck(view),
            },
            {
              kind: 'switch',
              label: t('Typewriter mode'),
              initial: false,
              get: () => modes.typewriter,
              set: () => modes.toggleTypewriter(view),
            },
            {
              kind: 'switch',
              label: t('Focus mode'),
              initial: false,
              get: () => modes.focus,
              set: () => modes.toggleFocus(view),
            },
          ],
        },
        {
          title: t('Code'),
          fields: [
            {
              kind: 'select',
              label: t('Highlighting'),
              options: CODE_PALETTES.map((one) => ({ value: one.id, label: one.name })),
              initial: 'follow',
              get: () => modes.codeTheme,
              set: (value) => modes.setCodeTheme(value, view),
            },
            {
              kind: 'switch',
              label: t('Line numbers'),
              initial: false,
              get: () => modes.lineNumbers,
              set: () => modes.toggleLineNumbers(view),
            },
          ],
        },
      ],
    },

    {
      id: 'markdown',
      label: t('Markdown'),
      groups: [
        {
          title: t('Syntax'),
          fields: [
            {
              kind: 'switch',
              label: t('Strict CommonMark'),
              initial: false,
              get: () => modes.strict,
              set: () => modes.toggleStrict(view),
            },
            {
              kind: 'switch',
              label: t('Smart punctuation'),
              initial: true,
              get: () => modes.punctuation,
              set: () => modes.togglePunctuation(view),
            },
          ],
        },
        {
          title: t('Numbering'),
          fields: [
            {
              kind: 'switch',
              label: t('Number headings'),
              initial: false,
              get: () => modes.numbers,
              set: () => modes.toggleNumbers(view),
            },
            {
              kind: 'switch',
              label: t('Number equations'),
              initial: false,
              get: () => modes.equationNumbers,
              set: () => modes.toggleEquationNumbers(view),
            },
          ],
        },
        {
          title: t('Direction'),
          fields: [
            {
              kind: 'switch',
              label: t('Right to left'),
              initial: false,
              get: () => modes.rtl,
              set: () => modes.toggleRightToLeft(view),
            },
          ],
        },
      ],
    },

    {
      id: 'appearance',
      label: t('Appearance'),
      groups: [
        {
          title: t('Theme'),
          fields: [
            {
              kind: 'select',
              label: t('Theme'),
              options: theme.all.map((one) => ({ value: one.id, label: t(one.name) })),
              get: () => theme.id,
              set: (value) => theme.select(value),
            },
          ],
        },
      ],
    },
  ]
}

/** Whether a field answers to what someone typed in the search box. */
export function matches(field: Field, query: string): boolean {
  return field.label.toLowerCase().includes(query.trim().toLowerCase())
}

/** Whether every field in the pane knows what it started as. */
export function resettable(pane: Pane): boolean {
  return pane.groups.every((group) => group.fields.every((field) => field.initial !== undefined))
}

/** Puts every field in the pane back to what it started as. Only the ones
 *  that differ are touched: a switch's setter may be a toggle, which would
 *  flip a value that was already right. */
export function resetPane(pane: Pane) {
  for (const group of pane.groups) {
    for (const field of group.fields) {
      if (field.initial === undefined || field.get() === field.initial) continue

      if (field.kind === 'switch') field.set(field.initial)
      else if (field.kind === 'slider') field.set(field.initial)
      else field.set(field.initial)
    }
  }
}
