import type { EditorView } from '@orden/editor'
import { DEFAULTS, modes } from '../../modes.svelte'
import type { Pane } from './fields'

export function markdownPane(view: EditorView | undefined): Pane {
  return {
    id: 'markdown',
    label: 'Markdown',
    groups: [
      {
        title: 'Syntax',
        fields: [
          {
            kind: 'switch',
            key: 'markdown.showMarkdown',
            label: 'Show markdown while writing',
            hint: 'Shows a mark such as ** or # while the cursor is in it; off keeps every mark out of sight.',
            words: ['syntax', 'marks', 'wysiwyg', 'rich text'],
            initial: true,
            get: () => !modes.quietMarks,
            set: () => modes.toggleQuietMarks(view),
          },
          {
            kind: 'switch',
            key: 'markdown.openInSource',
            label: 'Open notes in source mode',
            hint: 'Notes open as plain markdown text rather than formatted.',
            words: ['source mode', 'raw', 'plain text', 'default editing mode'],
            initial: DEFAULTS.opensInSource,
            get: () => modes.opensInSource,
            set: () => modes.toggleOpensInSource(),
          },
          {
            kind: 'switch',
            key: 'markdown.strictCommonMark',
            label: 'Strict CommonMark',
            hint: 'Only the standard markdown rules, no tables, task lists or footnotes.',
            initial: DEFAULTS.strict,
            get: () => modes.strict,
            set: () => modes.toggleStrict(view),
          },
          {
            kind: 'switch',
            key: 'markdown.smartPunctuation',
            label: 'Smart punctuation',
            hint: 'Turns straight quotes and dashes into typographic ones as you type.',
            initial: DEFAULTS.punctuation,
            get: () => modes.punctuation,
            set: () => modes.togglePunctuation(view),
          },
          {
            kind: 'switch',
            key: 'markdown.newlineBreaks',
            label: 'A single newline breaks the line',
            hint: 'Off is standard markdown: two lines of one paragraph read as one; Obsidian calls it strict line breaks.',
            initial: DEFAULTS.hardBreaks,
            get: () => modes.hardBreaks,
            set: () => modes.toggleHardBreaks(),
          },
        ],
      },
      {
        title: 'Numbering',
        fields: [
          {
            kind: 'switch',
            key: 'markdown.numberHeadings',
            label: 'Number headings',
            hint: 'Puts 1., 1.1, 1.2 in front of headings.',
            initial: DEFAULTS.numbers,
            get: () => modes.numbers,
            set: () => modes.toggleNumbers(view),
          },
          {
            kind: 'switch',
            key: 'markdown.numberEquations',
            label: 'Number equations',
            hint: 'Numbers display equations so you can refer to them.',
            initial: DEFAULTS.equationNumbers,
            get: () => modes.equationNumbers,
            set: () => modes.toggleEquationNumbers(view),
          },
        ],
      },
      {
        title: 'Direction',
        fields: [
          {
            kind: 'switch',
            key: 'markdown.rightToLeft',
            label: 'Right to left',
            hint: 'Writes notes from right to left, for Arabic, Hebrew and other such scripts.',
            initial: DEFAULTS.rtl,
            get: () => modes.rtl,
            set: () => modes.toggleRightToLeft(view),
          },
        ],
      },
    ],
  }
}
