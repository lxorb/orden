import type { EditorView } from '@orden/editor'
import { systemLocale } from '../region'
import { DEFAULTS, modes } from '../modes.svelte'
import {
  choosable,
  DICTIONARIES,
  dictionaryFor,
  inForceNow,
  machineLanguages,
  tellEngine,
  toggled,
} from '../spell-languages'
import type { Field, Group, Pane } from './fields'

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
        hint: 'Words are checked against this dictionary as well as every other one that is on.',
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

export function spellingPane(view: EditorView | undefined): Pane {
  return {
    id: 'spelling',
    label: 'Spelling',
    groups: [
      {
        title: 'Checking',
        ...(choosable
          ? {}
          : {
              caption: {
                text: 'Words are checked in the languages your system or browser is set to.',
              },
            }),
        fields: [
          {
            kind: 'switch',
            key: 'spelling.check',
            label: 'Check spelling',
            words: ['spellcheck', 'spell check', 'typos'],
            hint: 'Underlines misspelled words as you write.',
            initial: DEFAULTS.spellcheck,
            get: () => modes.spellcheck,
            set: () => modes.toggleSpellcheck(view),
          },
        ],
      },
      ...dictionaryGroups(view),
    ],
  }
}
