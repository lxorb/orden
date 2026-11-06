import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import { type Extension, Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { emojiCompletions } from './emoji'
import { once } from './once'
import { slashCompletions } from './slash'
import { snippetCompletions } from './snippets'
import { tagCompletions } from './tags'
import { takeHint, taskHint } from './live-preview/task-hint'
import { wikilinkCompletions } from './wikilink/complete'

const popupKeys = completionKeymap.filter((binding) => binding.key !== 'Ctrl-Space')

export const completing = once((pairs: boolean): Extension => [
  autocompletion({
    override: [
      slashCompletions,
      emojiCompletions,
      snippetCompletions,
      wikilinkCompletions,
      tagCompletions,
    ],
    icons: false,
    defaultKeymap: false,
  }),
  Prec.highest(keymap.of(popupKeys)),
  ...(pairs ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : []),
  taskHint,
  Prec.high(keymap.of([{ key: 'Tab', run: takeHint }])),
])
