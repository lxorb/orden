/** Everything the settings file may set (#673), as fields: each row of the panes that
 *  has a key, and what has a key but no row of its own to carry it - the settings of
 *  every theme the app ships with, not only the one worn; each command's key; the search
 *  engine. The schema is made from these (file-schema.ts) and the file is put in force
 *  through them (file.ts). Fetched with the file, never at the launch. */

import type { EditorView } from '@nib/editor'
import { t } from '../i18n.svelte'
import { modes } from '../modes.svelte'
import { declaredPanes } from '../preferences'
import { shortcuts, SHORTCUTS } from '../shortcuts.svelte'
import { enginesFor, isEngineAddress } from '../web-tab/engines'
import { CUSTOM, searchEngine } from '../web-tab/search-engine.svelte'
import { themeDeclarations } from './appearance-pane'
import { shortcutKey } from './declared.svelte'
import type { Field } from './fields'
import { part } from './hold'

/** Every command's key, by the command's id; one that cannot be moved has none. */
function shortcutFields(): Field[] {
  return [
    {
      kind: 'switch',
      key: 'shortcuts.vim',
      store: { on: modes, name: 'vim', shared: 'vim' },
      label: t('Vim keys'),
      hint: t('Moves and edits in notes with Vim’s keys.'),
      initial: false,
      get: () => modes.vim,
      set: (on) => modes.setVimKeys(on),
    },
    ...SHORTCUTS.filter((one) => one.scope !== 'fixed' && !one.alias).map((one): Field => ({
      kind: 'text',
      key: shortcutKey(one.id),
      store: { ...part(shortcuts, 'overrides', one.id), shared: 'shortcuts' },
      label: one.label(),
      hint: `The key that runs ${one.label()}, as the keys file writes it; empty for none.`,
      placeholder: '',
      check: (key) => (key === '' ? null : shortcuts.refuse(key)),
      get: () => shortcuts.keyFor(one.id) ?? '',
      set: (key) => shortcuts.set(one.id, key === '' ? null : key),
    })),
  ]
}

/** Where words typed in a web tab's address bar go. */
function searchFields(): Field[] {
  return [
    {
      kind: 'select',
      key: 'general.searchEngine',
      store: part(searchEngine, 'choice', 'id'),
      // The list is the reader's region's; `custom` is the address below.
      open: true,
      label: t('Search engine'),
      hint: t('Where words typed into a web tab’s address bar are searched.'),
      options: [
        ...enginesFor(navigator.language).map((one) => ({ value: one.id, label: one.name })),
        { value: CUSTOM, label: t('Custom') },
      ],
      get: () => searchEngine.id,
      set: (id) => searchEngine.choose(id),
    },
    {
      kind: 'text',
      key: 'general.searchEngineAddress',
      store: part(searchEngine, 'choice', 'custom'),
      label: t('Search engine'),
      hint: t('The search address, with %s where the words go.'),
      placeholder: 'https://search.example/?q=%s',
      check: (address) => (isEngineAddress(address) ? null : 'is not an address with %s in it'),
      get: () => searchEngine.custom,
      set: (address) => void searchEngine.setCustom(address),
    },
  ]
}

/** Every field the file may set, the first of any key twice: a theme's row in
 *  Appearance before the same setting declared for every theme. */
export async function declarations(view?: EditorView): Promise<Field[]> {
  const rows = declaredPanes(view).flatMap((pane) => pane.groups.flatMap((group) => group.fields))
  const all = [...rows, ...(await themeDeclarations()), ...shortcutFields(), ...searchFields()]
  const seen = new Set<string>()
  return all.filter((one) => {
    if (!one.key) return false
    // A list's members share its key.
    const name = one.member === undefined ? one.key : `${one.key}\u0000${one.member}`
    if (seen.has(name)) return false
    seen.add(name)
    return true
  })
}
