import { glassesGroups, wordFields } from '../even/settings'
import { t } from '../i18n.svelte'
import { modes } from '../modes.svelte'
import { isPlugin } from '../plugin'
import type { Pane } from './fields'

export function glassesPanes(): Pane[] {
  return isPlugin() || modes.glassesSeen
    ? ([
        {
          id: 'glasses',
          label: t('Glasses'),
          groups: [...glassesGroups(), { title: t('Spoken commands'), fields: wordFields() }],
        },
      ] satisfies Pane[])
    : []
}
