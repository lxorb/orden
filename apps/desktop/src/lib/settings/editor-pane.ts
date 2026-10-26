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
            key: 'editor.textSize',
            store: { on: modes, name: 'zoom' },
            label: t('Text size'),
            hint: t('How large the text of notes is.'),
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
            key: 'editor.lineSpacing',
            store: { on: modes, name: 'lineHeight' },
            label: t('Line spacing'),
            hint: t('The space between the lines of a note.'),
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
            key: 'editor.lineWidth',
            store: { on: modes, name: 'width' },
            label: t('Line width'),
            hint: t('How wide a line of a note grows before it wraps.'),
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
            key: 'editor.closeBrackets',
            store: { on: modes, name: 'closeBrackets' },
            label: t('Close brackets and quotes'),
            hint: t('Typing an opening bracket or quote adds the closing one too.'),
            words: ['auto pair', 'autoclose'],
            initial: DEFAULTS.closeBrackets,
            get: () => modes.closeBrackets,
            set: () => modes.toggleCloseBrackets(view),
          },
          {
            kind: 'switch',
            key: 'editor.typewriterMode',
            store: { on: modes, name: 'typewriter' },
            label: t('Typewriter mode'),
            hint: t('Keeps the line you are writing in the middle of the screen.'),
            words: ['centre', 'center', 'scroll'],
            initial: DEFAULTS.typewriter,
            get: () => modes.typewriter,
            set: () => modes.toggleTypewriter(view),
          },
          {
            kind: 'switch',
            key: 'editor.focusMode',
            store: { on: modes, name: 'focus' },
            label: t('Focus mode'),
            hint: t('Dims everything but the paragraph you are writing in.'),
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
            key: 'editor.ligatures',
            store: { on: modes, name: 'ligatures', shared: 'ligatures' },
            label: t('Ligatures'),
            hint: t('Joins pairs such as -> or != into one sign, in code only or everywhere.'),
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
            key: 'editor.attachments',
            store: { on: modes, name: 'attachments', shared: 'attachments' },
            label: t('Attachments'),
            hint: t('Where a picture or file you paste or drop into a note is saved.'),
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
        // Two fingers on a canvas move it and zoom it; with this on they turn it as
        // well, as Concepts does (#351). On, with the snap holding it upright until a turn
        // is plainly meant (#487). On the account; a page note never turns.
        title: t('Canvas'),
        fields: [
          {
            kind: 'switch',
            key: 'editor.canvasRotation',
            store: { on: modes, name: 'canvasTurns', shared: 'canvasTurns' },
            label: t('Rotate a canvas with two fingers'),
            hint: t('Turning two fingers on a touchpad or screen rotates the canvas.'),
            words: ['canvas', 'rotate', 'turn', 'two fingers', 'pinch', 'concepts', 'trackpad'],
            initial: DEFAULTS.canvasTurns,
            get: () => modes.canvasTurns,
            set: (on) => modes.setCanvasTurns(on),
          },
          {
            kind: 'switch',
            key: 'editor.canvasRotationSnaps',
            store: { on: modes, name: 'canvasTurnSnaps', shared: 'canvasTurnSnaps' },
            label: t('Snap the rotation to right angles'),
            hint: t('A rotation that ends near a right angle settles on it.'),
            words: ['canvas', 'rotate', 'turn', 'snap', 'upright', 'right angle', 'straight'],
            initial: DEFAULTS.canvasTurnSnaps,
            get: () => modes.canvasTurnSnaps,
            set: (on) => modes.setCanvasTurnSnaps(on),
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
            key: 'editor.newPages',
            store: { on: modes, name: 'pagesPaper' },
            label: t('New pages'),
            hint: t('The paper size a new page note starts with.'),
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
            key: 'editor.noteName',
            store: { on: settings, name: 'noteIdFormat' },
            label: t('Name'),
            hint: t('How the name of a new unique note is made from the date and time.'),
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
            key: 'editor.newLinks',
            store: { on: modes, name: 'linkFormat', shared: 'linkFormat' },
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
            key: 'editor.codeHighlighting',
            store: { on: modes, name: 'codeTheme' },
            label: t('Highlighting'),
            hint: t('The colours code in a note is highlighted in.'),
            words: ['syntax', 'code colours', 'code colors'],
            options: CODE_PALETTES.map((one) => ({ value: one.id, label: one.name })),
            initial: DEFAULTS.codeTheme,
            get: () => modes.codeTheme,
            set: (value) => modes.setCodeTheme(value, view),
          },
          {
            kind: 'switch',
            key: 'editor.codeLineNumbers',
            store: { on: modes, name: 'lineNumbers' },
            label: t('Line numbers'),
            hint: t('Numbers the lines of code blocks.'),
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
