import { MARKS } from '../../marks/src/api'
import { locked, setKind, gated, hiddenKinds } from '../../gates/src/api'
import { kindName, kindLines, lineTitle, newKinds } from '../../new-here/src/api'
import type { Field, Group, Pane } from './fields'

function kindGroups(): Group[] {
  return kindLines(newKinds().filter((one) => !gated(one.kind))).map((line) => ({
    title: lineTitle(line[0]?.line ?? 'notes'),
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
