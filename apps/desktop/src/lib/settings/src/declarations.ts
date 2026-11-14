import { registered, settingFieldsIn } from '@orden/contracts'
import type { EditorView } from '@orden/editor'
import { modes } from '../../modes.svelte'
import { declaredPanes } from './preferences'
import { shortcuts, SHORTCUTS } from '../../shortcuts.svelte'
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
      label: 'Vim keys',
      hint: 'Moves and edits in notes with Vim’s keys.',
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

export async function declarations(view?: EditorView): Promise<Field[]> {
  await registered()
  const rows = declaredPanes(view).flatMap((pane) => pane.groups.flatMap((group) => group.fields))
  const all = [
    ...rows,
    ...(await themeDeclarations()),
    ...shortcutFields(),
    ...settingFieldsIn('general', 'Browser'),
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
