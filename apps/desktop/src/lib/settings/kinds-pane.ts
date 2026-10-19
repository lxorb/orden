import { MARKS } from '../file-mark'
import { t } from '../i18n.svelte'
import { locked, setKind } from '../kind-choice'
import { kindName } from '../kind-words'
import { kindLines, newKinds } from '../new-kinds'
import { hiddenKinds } from '../settings.svelte'
import type { Field, Group, Pane } from './fields'

/** The kinds this device can make, one switch each, in their lines under the word each
 *  line already has elsewhere. On to begin with, so the pane's reset turns every one back
 *  on. */
function kindGroups(): Group[] {
  const titles = { write: t('Notes'), run: t('Terminal'), web: t('Web') }

  return kindLines(newKinds()).map((line) => ({
    title: titles[line[0]?.line ?? 'write'],
    fields: line.map((one): Field => ({
      kind: 'switch',
      label: kindName(one.kind),
      // `new tab` and `ctrl+t`, because the new tab is where these are offered, and that is
      // what somebody who wants one gone looks for (#355).
      words: ['type', 'kind', 'new', 'new tab', 'ctrl+t', 'create', 'hide', 'show', one.kind],
      icon: one.icon ?? MARKS[one.mark],
      initial: true,
      locked: () => locked(one.kind),
      get: () => hiddenKinds.offers(one.kind),
      set: (on) => setKind(one.kind, on),
    })),
  }))
}

/** Settings › Note types; see `preferences` in ../preferences.ts. */
export function kindsPane(): Pane {
  return {
    // Which kinds of tab anything offers to make, in the lines the new tab draws them
    // in. Only the making: a file of a kind turned off opens, edits and syncs as it
    // always did. See kind-choice.ts.
    id: 'kinds',
    label: t('Note types'),
    groups: kindGroups(),
  }
}
