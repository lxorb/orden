import type { EditorView } from '@nib/editor'
import { CODE_PALETTES } from '@nib/editor'
import { i18n, LANGUAGES, t } from './i18n.svelte'
import { modes } from './modes.svelte'
import { theme } from './theme.svelte'
import { workspace } from './workspace.svelte'

/** One control, and how to read and write whatever sits behind it. */
export type Field =
  | { kind: 'switch'; label: string; get(): boolean; set(on: boolean): void }
  | {
      kind: 'slider'
      label: string
      min: number
      max: number
      step: number
      unit?: string
      get(): number
      set(value: number): void
    }
  | {
      kind: 'select'
      label: string
      options: { value: string; label: string }[]
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
              get: () => modes.zoom,
              set: (value) => modes.setZoom(value),
            },
            {
              kind: 'slider',
              label: t('Line spacing'),
              min: 1.3,
              max: 2.2,
              step: 0.02,
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
              get: () => modes.closeBrackets,
              set: () => modes.toggleCloseBrackets(view),
            },
            {
              kind: 'switch',
              label: t('Check spelling'),
              get: () => modes.spellcheck,
              set: () => modes.toggleSpellcheck(view),
            },
            {
              kind: 'switch',
              label: t('Typewriter mode'),
              get: () => modes.typewriter,
              set: () => modes.toggleTypewriter(view),
            },
            {
              kind: 'switch',
              label: t('Focus mode'),
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
              get: () => modes.codeTheme,
              set: (value) => modes.setCodeTheme(value, view),
            },
            {
              kind: 'switch',
              label: t('Line numbers'),
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
              get: () => modes.strict,
              set: () => modes.toggleStrict(view),
            },
            {
              kind: 'switch',
              label: t('Smart punctuation'),
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
              get: () => modes.numbers,
              set: () => modes.toggleNumbers(view),
            },
            {
              kind: 'switch',
              label: t('Number equations'),
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
