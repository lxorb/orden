import { MARKS } from '../file-mark'
import { t } from '../i18n.svelte'
import { locked, setKind } from '../kind-choice'
import { kindName } from '../kind-words'
import { kindLines, newKinds } from '../new-kinds'
import { choiceWord, hiddenKinds, offUntilShown } from '../settings.svelte'
import type { Field, Group, Pane } from './fields'
import { among } from './hold'

function kindGroups(): Group[] {
  const titles = { write: t('Notes'), run: t('Terminal'), web: t('Web') }

  return kindLines(newKinds()).map((line) => ({
    title: titles[line[0]?.line ?? 'write'],
    fields: line.map((one): Field => ({
      kind: 'switch',
      key: `kinds.${one.kind}`,
      store: { ...among(hiddenKinds, 'hidden', choiceWord(one.kind)), shared: 'hiddenKinds' },
      label: kindName(one.kind),
      hint: t('Offers this type when you make something new; off only takes it out of that list.'),
      words: ['type', 'kind', 'new', 'new tab', 'ctrl+t', 'create', 'hide', 'show', one.kind],
      icon: one.icon ?? MARKS[one.mark],
      initial: !offUntilShown(one.kind),
      locked: () => locked(one.kind),
      get: () => hiddenKinds.offers(one.kind),
      set: (on) => setKind(one.kind, on),
    })),
  }))
}

export function kindsPane(): Pane {
  return {
    id: 'kinds',
    label: t('Note types'),
    groups: kindGroups(),
  }
}
