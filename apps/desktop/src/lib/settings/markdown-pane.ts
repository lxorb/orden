import type { EditorView } from '@orden/editor'
import { t } from '../i18n.svelte'
import { DEFAULTS, modes } from '../modes.svelte'
import { PROPERTIES_MODES } from '@orden/markdown/properties'
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
            key: 'markdown.showMarkdown',
            store: { on: modes, name: 'quietMarks', shared: 'quietMarks' },
            label: t('Show markdown while writing'),
            hint: t(
              'Shows a mark such as ** or # while the cursor is in it; off keeps every mark out of sight.',
            ),
            words: ['syntax', 'marks', 'wysiwyg', 'rich text'],
            initial: true,
            get: () => !modes.quietMarks,
            set: () => modes.toggleQuietMarks(view),
          },
          {
            // Obsidian's "Default editing mode"; #232.
            kind: 'switch',
            key: 'markdown.openInSource',
            store: { on: modes, name: 'opensInSource' },
            label: t('Open notes in source mode'),
            hint: t('Notes open as plain markdown text rather than formatted.'),
            words: ['source mode', 'raw', 'plain text', 'default editing mode'],
            initial: DEFAULTS.opensInSource,
            get: () => modes.opensInSource,
            set: () => modes.toggleOpensInSource(),
          },
          {
            kind: 'switch',
            key: 'markdown.strictCommonMark',
            store: { on: modes, name: 'strict' },
            label: t('Strict CommonMark'),
            hint: t('Only the standard markdown rules, no tables, task lists or footnotes.'),
            initial: DEFAULTS.strict,
            get: () => modes.strict,
            set: () => modes.toggleStrict(view),
          },
          {
            kind: 'switch',
            key: 'markdown.smartPunctuation',
            store: { on: modes, name: 'punctuation' },
            label: t('Smart punctuation'),
            hint: t('Turns straight quotes and dashes into typographic ones as you type.'),
            initial: DEFAULTS.punctuation,
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
            key: 'markdown.newlineBreaks',
            store: { on: modes, name: 'hardBreaks', shared: 'hardBreaks' },
            label: t('A single newline breaks the line'),
            hint: t(
              'Off is standard markdown: two lines of one paragraph read as one; Obsidian calls it strict line breaks.',
            ),
            initial: DEFAULTS.hardBreaks,
            get: () => modes.hardBreaks,
            set: () => modes.toggleHardBreaks(),
          },
          {
            // What a note's front matter is drawn as. Three answers, not two, so a
            // segmented row rather than a switch - and the same three Obsidian
            // asks with. Read by the editor and by the reading view, so a note
            // cannot say one thing written and another read.
            kind: 'segmented',
            key: 'markdown.frontMatter',
            store: { on: modes, name: 'properties', shared: 'properties' },
            label: t('Front matter'),
            words: ['properties', 'yaml', 'metadata'],
            hint: t(
              'Properties draws the rows and edits them in place; Source is the YAML as typed.',
            ),
            options: PROPERTIES_MODES.map((one) => ({
              value: one,
              label: t(PROPERTIES_WORDS[one]),
            })),
            initial: DEFAULTS.properties,
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
            key: 'markdown.numberHeadings',
            store: { on: modes, name: 'numbers' },
            label: t('Number headings'),
            hint: t('Puts 1., 1.1, 1.2 in front of headings.'),
            initial: DEFAULTS.numbers,
            get: () => modes.numbers,
            set: () => modes.toggleNumbers(view),
          },
          {
            kind: 'switch',
            key: 'markdown.numberEquations',
            store: { on: modes, name: 'equationNumbers' },
            label: t('Number equations'),
            hint: t('Numbers display equations so you can refer to them.'),
            initial: DEFAULTS.equationNumbers,
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
            key: 'markdown.rightToLeft',
            store: { on: modes, name: 'rtl' },
            label: t('Right to left'),
            hint: t('Writes notes from right to left, for Arabic, Hebrew and other such scripts.'),
            initial: DEFAULTS.rtl,
            get: () => modes.rtl,
            set: () => modes.toggleRightToLeft(view),
          },
        ],
      },
    ],
  }
}
