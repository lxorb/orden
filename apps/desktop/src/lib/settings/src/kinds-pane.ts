import { MARKS } from '../../marks/src/api'
import { locked, setKind } from '../../kind-choice'
import { kindName, kindLines, newKinds } from '../../new-here/src/api'
import { gated, hiddenKinds } from '../../gates/src/api'
import type { Field, Group, Pane } from './fields'

function kindGroups(): Group[] {
  const titles = { write: 'Notes', run: 'Terminal', web: 'Web' }

  return kindLines(newKinds().filter((one) => !gated(one.kind))).map((line) => ({
    title: titles[line[0]?.line ?? 'write'],
    fields: line.map((one): Field => ({
      kind: 'switch',
      key: `kinds.${one.kind}`,
      label: kindName(one.kind),
      hint: 'Offers this type when you make something new; off only takes it out of that list.',
      words: ['type', 'kind', 'new', 'new tab', 'ctrl+t', 'create', 'hide', 'show', one.kind],
      icon: one.icon ?? MARKS[one.mark],
      initial: true,
      locked: () => locked(one.kind),
      get: () => hiddenKinds.offers(one.kind),
      set: (on) => setKind(one.kind, on),
    })),
  }))
}

export function kindsPane(): Pane {
  return {
    id: 'kinds',
    label: 'Note types',
    groups: kindGroups(),
  }
}
