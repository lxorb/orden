import type { EditorView } from '@orden/editor'
import { systemLocale } from '../../platform/src/api'
import { DEFAULTS, modes } from '../../modes/src/api'
import {
  choosable,
  DICTIONARIES,
  dictionaryFor,
  inForceNow,
  machineLanguages,
  tellEngine,
  toggled,
} from '../../spelling/src/api'
import type { Field, Group } from './fields'

function dictionaryGroups(view: EditorView | undefined): Group[] {
  if (!choosable) return []
  const first = dictionaryFor(systemLocale(), machineLanguages())
  return [
    {
      title: 'Dictionary',
      fields: DICTIONARIES.map((one): Field => ({
        kind: 'switch',
        key: 'spelling.languages',
        member: one.id,
        label: one.name,
        words: ['dictionary', 'language', 'spellcheck', one.id],
        initial: one.id === first,
        locked: () => {
          const now = inForceNow(modes.spellLanguages)
          return now.length === 1 && now.includes(one.id)
        },
        get: () => inForceNow(modes.spellLanguages).includes(one.id),
        set: (on) => {
          const next = toggled(modes.spellLanguages, one.id, on)
          if (!next) return
          modes.setSpellLanguages(next, view)
          tellEngine(next)
        },
      })),
    },
  ]
}
export function spellingGroups(view: EditorView | undefined): Group[] {
  return [
    {
      title: 'Spelling',
      fields: [
        {
          kind: 'switch',
          key: 'spelling.check',
          label: 'Check spelling',
          words: ['spellcheck', 'spell check', 'typos'],
          initial: DEFAULTS.spellcheck,
          get: () => modes.spellcheck,
          set: () => modes.toggleSpellcheck(view),
        },
      ],
    },
    ...dictionaryGroups(view),
  ]
}
