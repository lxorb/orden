import type { EditorView } from '@orden/editor'
import { i18n, t } from '../i18n.svelte'
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
import { among } from './hold'

/** The dictionaries, a switch apiece, where the engine has a list to give them to; and
 *  where it has not, a line saying whose languages it checks in (#771). See
 *  spell-languages.ts. */
function dictionaryGroups(view: EditorView | undefined): Group[] {
  if (!choosable) return []

  const first = dictionaryFor(i18n.language, machineLanguages())
  return [
    {
      title: t('Dictionary'),
      fields: DICTIONARIES.map((one): Field => ({
        kind: 'switch',
        // One member of the list the settings file gives (#673).
        key: 'spelling.languages',
        member: one.id,
        store: among(modes, 'spellLanguages', one.id),
        label: one.name,
        words: ['dictionary', 'language', 'spellcheck', one.id],
        hint: t('Words are checked against this dictionary as well as every other one that is on.'),
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

/** Settings › Spelling; see `preferences` in ../preferences.ts. */
export function spellingPane(view: EditorView | undefined): Pane {
  return {
    id: 'spelling',
    label: t('Spelling'),
    groups: [
      {
        title: t('Checking'),
        ...(choosable
          ? {}
          : {
              caption: {
                text: t('Words are checked in the languages your system or browser is set to.'),
              },
            }),
        fields: [
          {
            kind: 'switch',
            key: 'spelling.check',
            store: { on: modes, name: 'spellcheck' },
            label: t('Check spelling'),
            words: ['spellcheck', 'spell check', 'typos'],
            hint: t('Underlines misspelled words as you write.'),
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
