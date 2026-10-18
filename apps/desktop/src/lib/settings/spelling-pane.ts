import type { EditorView } from '@nib/editor'
import { t } from '../i18n.svelte'
import { DEFAULTS, modes } from '../modes.svelte'
import type { Pane } from './fields'

/** Dictionaries the browser's checker can be pointed at, named the way their
 *  speakers name them, so they read the same whatever the app's language.
 *  `system` leaves the choice to the browser. Written in the order every language
 *  list keeps (language-order.ts), which the test holds it to. */
const DICTIONARIES = [
  { id: 'system', name: 'Match the system' },
  { id: 'de', name: 'Deutsch' },
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Español' },
  { id: 'fr', name: 'Français' },
  { id: 'it', name: 'Italiano' },
  { id: 'nl', name: 'Nederlands' },
  { id: 'pt', name: 'Português' },
  { id: 'ja', name: '日本語' },
] as const

/** Settings › Spelling; see `preferences` in ../preferences.ts. */
export function spellingPane(view: EditorView | undefined): Pane {
  return {
    id: 'spelling',
    label: t('Spelling'),
    groups: [
      {
        title: t('Checking'),
        fields: [
          {
            kind: 'switch',
            label: t('Check spelling'),
            words: ['spellcheck', 'spell check', 'typos'],
            initial: DEFAULTS.spellcheck,
            get: () => modes.spellcheck,
            set: () => modes.toggleSpellcheck(view),
          },
        ],
      },
      {
        // The browser checks against the dictionary the surface's language
        // names, so this is the one setting that decides whose words are
        // wrong.
        title: t('Dictionary'),
        fields: [
          {
            kind: 'select',
            label: t('Language'),
            options: DICTIONARIES.map((one) => ({ value: one.id, label: t(one.name) })),
            initial: DEFAULTS.spellLanguage,
            get: () => modes.spellLanguage,
            set: (value) => modes.setSpellLanguage(value, view),
          },
        ],
      },
    ],
  }
}
