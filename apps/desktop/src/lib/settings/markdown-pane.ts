import type { EditorView } from '@orden/editor'
import { t } from '../i18n.svelte'
import { DEFAULTS, modes } from '../modes.svelte'
import type { Pane } from './fields'

export function markdownPane(view: EditorView | undefined): Pane {
  return {
    id: 'markdown',
    label: t('Markdown'),
    groups: [
      {
        title: t('Syntax'),
        fields: [
          {
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
