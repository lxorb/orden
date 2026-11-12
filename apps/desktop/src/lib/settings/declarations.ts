import type { EditorView } from '@orden/editor'
import { t } from '../i18n.svelte'
import { modes } from '../modes.svelte'
import { declaredPanes } from '../preferences'
import { shortcuts, SHORTCUTS } from '../shortcuts.svelte'
import { enginesFor, isEngineAddress } from '../web-tab/engines'
import { CUSTOM, searchEngine } from '../web-tab/search-engine.svelte'
import { themeDeclarations } from './appearance-pane'
import { relockField } from './general-pane'
import type { Field } from './fields'

function shortcutKey(id: string): string {
  return `shortcuts.${id.replaceAll('.', '-')}`
}

function shortcutFields(): Field[] {
  return [
    {
      kind: 'switch',
      key: 'shortcuts.vim',
      label: t('Vim keys'),
      hint: t('Moves and edits in notes with Vim’s keys.'),
      initial: false,
      get: () => modes.vim,
      set: (on) => modes.setVimKeys(on),
    },
    ...SHORTCUTS.filter((one) => one.scope !== 'fixed' && !one.alias).map((one): Field => ({
      kind: 'text',
      key: shortcutKey(one.id),
      label: one.label(),
      hint: `The key that runs ${one.label()}, as the keys file writes it; empty for none.`,
      placeholder: '',
      check: (key) => (key === '' ? null : shortcuts.refuse(key, one.id)),
      get: () => shortcuts.keyFor(one.id) ?? '',
      set: (key) => shortcuts.set(one.id, key === '' ? null : key),
    })),
  ]
}

function searchFields(): Field[] {
  return [
    {
      kind: 'select',
      key: 'general.searchEngine',
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
      label: t('Search engine'),
      hint: t('The search address, with %s where the words go.'),
      placeholder: 'https://search.example/?q=%s',
      check: (address) => (isEngineAddress(address) ? null : 'is not an address with %s in it'),
      get: () => searchEngine.custom,
      set: (address) => void searchEngine.setCustom(address),
    },
  ]
}

export async function declarations(view?: EditorView): Promise<Field[]> {
  const rows = declaredPanes(view).flatMap((pane) => pane.groups.flatMap((group) => group.fields))
  const all = [
    ...rows,
    ...(await themeDeclarations()),
    ...shortcutFields(),
    ...searchFields(),
    ...(__EVEN_PLUGIN__ ? [] : [relockField()]),
  ]
  const seen = new Set<string>()
  return all.filter((one) => {
    if (!one.key) return false
    const name = one.member === undefined ? one.key : `${one.key}\u0000${one.member}`
    if (seen.has(name)) return false
    seen.add(name)
    return true
  })
}
