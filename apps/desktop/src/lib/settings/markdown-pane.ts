import type { EditorView } from '@nib/editor'
import { t } from '../i18n.svelte'
import { modes } from '../modes.svelte'
import { PROPERTIES_MODES } from '@nib/markdown/properties'
import { PROPERTIES_WORDS } from '../properties-words'
import type { Pane } from './fields'

/** Settings › Markdown; see `preferences` in ../preferences.ts. */
export function markdownPane(view: EditorView | undefined): Pane {
  return {
    id: 'markdown',
    label: t('Markdown'),
    groups: [
      {
        title: t('Syntax'),
        fields: [
          {
            // Notion's and Word's way round: the words wear their formatting and
            // the marks never come back while writing. On, which is Typora's and
            // Obsidian's live preview, where a mark shows while the caret is in it.
            kind: 'switch',
            label: t('Show markdown while writing'),
            words: ['syntax', 'marks', 'wysiwyg', 'rich text'],
            initial: true,
            get: () => !modes.quietMarks,
            set: () => modes.toggleQuietMarks(view),
          },
          {
            // Obsidian's "Default editing mode"; #232.
            kind: 'switch',
            label: t('Open notes in source mode'),
            words: ['source mode', 'raw', 'plain text', 'default editing mode'],
            initial: false,
            get: () => modes.opensInSource,
            set: () => modes.toggleOpensInSource(),
          },
          {
            kind: 'switch',
            label: t('Strict CommonMark'),
            hint: t('Only the standard markdown rules, no tables, task lists or footnotes.'),
            initial: false,
            get: () => modes.strict,
            set: () => modes.toggleStrict(view),
          },
          {
            kind: 'switch',
            label: t('Smart punctuation'),
            hint: t('Turns straight quotes and dashes into typographic ones as you type.'),
            initial: false,
            get: () => modes.punctuation,
            set: () => modes.togglePunctuation(view),
          },
          {
            // What CommonMark says a single newline is, and what Obsidian's own
            // "Strict line breaks" asks the other way round. Off, which is the
            // standard and what every other reader does with the same file; the
            // hint says what Obsidian calls it so nobody has to guess which
            // switch is which.
            kind: 'switch',
            label: t('A single newline breaks the line'),
            hint: t(
              'Off is standard markdown: two lines of one paragraph read as one; Obsidian calls it strict line breaks.',
            ),
            initial: false,
            get: () => modes.hardBreaks,
            set: () => modes.toggleHardBreaks(),
          },
          {
            // What a note's front matter is drawn as. Three answers, not two, so a
            // segmented row rather than a switch - and the same three Obsidian
            // asks with. Read by the editor and by the reading view, so a note
            // cannot say one thing written and another read.
            kind: 'segmented',
            label: t('Front matter'),
            words: ['properties', 'yaml', 'metadata'],
            hint: t(
              'Properties draws the rows and edits them in place; Source is the YAML as typed.',
            ),
            options: PROPERTIES_MODES.map((one) => ({
              value: one,
              label: t(PROPERTIES_WORDS[one]),
            })),
            initial: 'hidden',
            get: () => modes.properties,
            set: (value) => modes.setProperties(value, view),
          },
        ],
      },
      {
        title: t('Numbering'),
        fields: [
          {
            kind: 'switch',
            label: t('Number headings'),
            hint: t('Puts 1., 1.1, 1.2 in front of headings.'),
            initial: false,
            get: () => modes.numbers,
            set: () => modes.toggleNumbers(view),
          },
          {
            kind: 'switch',
            label: t('Number equations'),
            hint: t('Numbers display equations so you can refer to them.'),
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
  }
}
