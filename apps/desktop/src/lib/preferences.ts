import type { EditorView } from '@nib/editor'
import { CODE_PALETTES } from '@nib/editor'
import { i18n, LANGUAGES, t } from './i18n.svelte'
import { modes } from './modes.svelte'
import { DEFAULT_ID_FORMAT, ID_FORMATS, noteId } from './note-id'
import { DEFAULT_DAYS, DEFAULT_MINUTES, KEEP_DAYS, SNAPSHOT_MINUTES } from './recovery'
import { recovery } from './recovery.svelte'
import { settings } from './settings.svelte'
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

/** Dictionaries the browser's checker can be pointed at, named the way their
 *  speakers name them, so they read the same whatever the app's language.
 *  `system` leaves the choice to the browser. */
const DICTIONARIES = [
  { id: 'system', name: 'Match the system' },
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch' },
  { id: 'fr', name: 'Français' },
  { id: 'es', name: 'Español' },
  { id: 'it', name: 'Italiano' },
  { id: 'nl', name: 'Nederlands' },
  { id: 'pt', name: 'Português' },
  { id: 'ja', name: '日本語' },
] as const

/** The panes that are only about settings. Account, publishing and the LLM
 *  connector are their own thing and stay written out by hand. */
type PaneId = 'general' | 'editor' | 'spelling' | 'markdown' | 'appearance' | 'glasses'

export interface Pane {
  id: PaneId
  label: string
  groups: Group[]
}

/** Built against a live view so a change lands in the editor on screen. */
export function preferences(view?: EditorView): Pane[] {
  // One moment for every example on the pane, so the options read as one set of
  // spellings of the same time rather than as four different times.
  const moment = new Date()

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
          // A note being written in is kept every so often on top of what a
          // save keeps, so a crash between two saves is not the end of the
          // story; History is where the versions are.
          title: t('Recovery'),
          fields: [
            {
              kind: 'select',
              label: t('Keep a version every'),
              options: SNAPSHOT_MINUTES.map((minutes) => ({
                value: String(minutes),
                label: minutes ? t('{count} min', { count: minutes }) : t('Off'),
              })),
              initial: String(DEFAULT_MINUTES),
              get: () => String(recovery.every),
              set: (value) => recovery.setEvery(Number(value)),
            },
            {
              kind: 'select',
              label: t('Keep versions for'),
              options: KEEP_DAYS.map((days) => ({
                value: String(days),
                label: days === 1 ? t('1 day') : t('{count} days', { count: days }),
              })),
              initial: String(DEFAULT_DAYS),
              get: () => String(recovery.days),
              set: (value) => recovery.setDays(Number(value)),
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
            {
              // `->` drawn as an arrow, and its kind. A scope rather than a
              // switch: an arrow is welcome where it is an operator and a
              // surprise in the middle of a sentence, so code can have it on
              // its own.
              kind: 'select',
              label: t('Ligatures'),
              options: [
                { value: 'off', label: t('Off') },
                { value: 'code', label: t('Code only') },
                { value: 'all', label: t('Everywhere') },
              ],
              initial: 'off',
              get: () => modes.ligatures,
              set: (value) => modes.setLigatures(value, view),
            },
            {
              // Modal editing over whichever keyboard the shortcuts are on.
              // The Vim preset turns this on; it is here so it can also be on
              // over the Obsidian or the Notion map.
              kind: 'switch',
              label: t('Vim keys'),
              initial: false,
              get: () => modes.vim,
              set: (on) => modes.setVimKeys(on, view),
            },
            {
              // Where a pasted or dropped picture lands. What the note says
              // stays relative to the note either way, so the choice changes
              // nothing about notes already written.
              kind: 'select',
              label: t('Attachments'),
              options: [
                { value: 'space', label: t('Assets folder of the space') },
                { value: 'note', label: t('Next to the note') },
                { value: 'named', label: t('A folder named after the note') },
              ],
              initial: 'space',
              get: () => modes.attachments,
              set: (value) => modes.setAttachments(value),
            },
          ],
        },
        {
          // What "New unique note" names a note. Each option is labelled with
          // what it would produce right now, which says more than the tokens do.
          title: t('Unique note names'),
          fields: [
            {
              kind: 'select',
              label: t('Name'),
              options: ID_FORMATS.map((format) => ({
                value: format,
                label: noteId(format, moment),
              })),
              initial: DEFAULT_ID_FORMAT,
              get: () => settings.noteIdFormat,
              set: (value) => settings.setNoteIdFormat(value),
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
      id: 'spelling',
      label: t('Spelling'),
      groups: [
        {
          title: t('Checking'),
          fields: [
            {
              kind: 'switch',
              label: t('Check spelling'),
              initial: false,
              get: () => modes.spellcheck,
              set: () => modes.toggleSpellcheck(view),
            },
          ],
        },
        {
          // The browser checks against the dictionary the surface's language
          // names, so this is the one setting that decides whose words are
          // wrong.
          title: t('Dictionary'),
          fields: [
            {
              kind: 'select',
              label: t('Language'),
              options: DICTIONARIES.map((one) => ({ value: one.id, label: t(one.name) })),
              initial: 'system',
              get: () => modes.spellLanguage,
              set: (value) => modes.setSpellLanguage(value, view),
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

    {
      id: 'glasses',
      label: t('Glasses'),
      groups: [
        {
          title: t('Even Realities'),
          fields: [
            {
              // How a note reaches the G2. Drawn is the point of the plugin and
              // the default: the app's own faces, its highlighted code, its
              // formulae and its tables. Text hands the words to the glasses and
              // lets the firmware set them, which is one call over the radio
              // rather than four, so a page turn arrives at once rather than a
              // quarter at a time. Two words, because there are two answers.
              kind: 'select',
              label: t('Display'),
              options: [
                { value: 'rendered', label: t('Rendered') },
                { value: 'text', label: t('Text') },
              ],
              initial: 'rendered',
              get: () => modes.glassesDisplay,
              set: (value) => modes.setGlassesDisplay(value),
            },
          ],
        },
      ],
    },
  ]
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
