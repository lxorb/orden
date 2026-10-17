import type { EditorView } from '@nib/editor'
import { CODE_PALETTES } from '@nib/editor'
import { t } from '../i18n.svelte'
import { DEFAULTS, modes } from '../modes.svelte'
import { DEFAULT_ID_FORMAT, ID_FORMATS, noteId } from '../note-id'
import { settings } from '../settings.svelte'
import type { Pane } from './fields'

/** Settings › Editor; see `preferences` in ../preferences.ts. */
export function editorPane(view: EditorView | undefined, moment: Date): Pane {
  return {
    id: 'editor',
    label: t('Editor'),
    groups: [
      {
        title: t('Text'),
        fields: [
          {
            kind: 'slider',
            label: t('Text size'),
            words: ['font', 'zoom', 'bigger', 'smaller'],
            min: 0.8,
            max: 1.6,
            step: 0.05,
            unit: '×',
            initial: DEFAULTS.zoom,
            get: () => modes.zoom,
            set: (value) => modes.setZoom(value),
          },
          {
            kind: 'slider',
            label: t('Line spacing'),
            words: ['line height', 'leading'],
            min: 1.3,
            max: 2.2,
            step: 0.02,
            initial: DEFAULTS.lineHeight,
            get: () => modes.lineHeight,
            set: (value) => modes.setLineSpacing(value, view),
          },
          {
            kind: 'slider',
            label: t('Line width'),
            words: ['column', 'wide', 'readable width'],
            min: 30,
            max: 70,
            step: 1,
            unit: 'rem',
            initial: DEFAULTS.width,
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
            words: ['auto pair', 'autoclose'],
            initial: DEFAULTS.closeBrackets,
            get: () => modes.closeBrackets,
            set: () => modes.toggleCloseBrackets(view),
          },
          {
            kind: 'switch',
            label: t('Typewriter mode'),
            words: ['centre', 'center', 'scroll'],
            initial: DEFAULTS.typewriter,
            get: () => modes.typewriter,
            set: () => modes.toggleTypewriter(view),
          },
          {
            kind: 'switch',
            label: t('Focus mode'),
            words: ['zen', 'distraction free', 'dim'],
            initial: DEFAULTS.focus,
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
            words: ['font'],
            options: [
              { value: 'off', label: t('Off') },
              { value: 'code', label: t('Code only') },
              { value: 'all', label: t('Everywhere') },
            ],
            initial: DEFAULTS.ligatures,
            get: () => modes.ligatures,
            set: (value) => modes.setLigatures(value, view),
          },
          {
            // Where a pasted or dropped picture lands. What the note says
            // stays relative to the note either way, so the choice changes
            // nothing about notes already written.
            kind: 'select',
            label: t('Attachments'),
            words: ['images', 'pictures', 'paste', 'assets'],
            options: [
              { value: 'space', label: t('Assets folder of the space') },
              { value: 'note', label: t('Next to the note') },
              { value: 'named', label: t('A folder named after the note') },
            ],
            initial: DEFAULTS.attachments,
            get: () => modes.attachments,
            set: (value) => modes.setAttachments(value),
          },
        ],
      },
      {
        // The paper a page note starts on. A page already written on is changed from
        // its own menu in the panel, which is where somebody looking at a page is;
        // this is only what a new one is given. See PagesNavigator.svelte.
        title: t('Page notes'),
        fields: [
          {
            kind: 'select',
            label: t('New pages'),
            options: [
              { value: 'a4', label: t('A4') },
              { value: 'letter', label: t('Letter') },
              { value: 'long', label: t('Long page') },
            ],
            initial: DEFAULTS.pagesPaper,
            get: () => modes.pagesPaper,
            set: (value) => modes.setPagesPaper(value),
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
        // How a link to another note is written. Not what is read: both
        // spellings are read whatever this says, so a space may hold both and
        // nothing already written changes.
        title: t('Links'),
        fields: [
          {
            kind: 'select',
            label: t('New links'),
            hint: t(
              'Wikilinks name the note, so a link survives it being renamed; both spellings are read either way.',
            ),
            options: [
              { value: 'wikilink', label: t('[[Wikilinks]]') },
              { value: 'shortest', label: t('Markdown, shortest name') },
              { value: 'relative', label: t('Markdown, relative path') },
              { value: 'absolute', label: t('Markdown, path in the space') },
            ],
            initial: DEFAULTS.linkFormat,
            get: () => modes.linkFormat,
            set: (value) => modes.setLinkFormat(value),
          },
        ],
      },
      {
        title: t('Code'),
        fields: [
          {
            kind: 'select',
            label: t('Highlighting'),
            words: ['syntax', 'code colours', 'code colors'],
            options: CODE_PALETTES.map((one) => ({ value: one.id, label: one.name })),
            initial: DEFAULTS.codeTheme,
            get: () => modes.codeTheme,
            set: (value) => modes.setCodeTheme(value, view),
          },
          {
            kind: 'switch',
            label: t('Line numbers'),
            words: ['gutter'],
            initial: DEFAULTS.lineNumbers,
            get: () => modes.lineNumbers,
            set: () => modes.toggleLineNumbers(view),
          },
        ],
      },
    ],
  }
}
