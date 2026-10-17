import { glassesGroups, wordFields } from '../even/settings'
import { t } from '../i18n.svelte'
import { modes } from '../modes.svelte'
import { isPlugin } from '../plugin'
import type { Pane } from './fields'

/** Settings › Glasses; see `preferences` in ../preferences.ts. */
export function glassesPanes(): Pane[] {
  // Only for somebody who has a pair. In the plugin always; on every other
  // device once the plugin has answered a pair of glasses at least once, which
  // the account remembers. Spread rather than left empty, so the pane does not
  // exist at all otherwise: an empty section is a question nobody asked, and
  // the settings search reads this same list.
  //
  // Every field in it comes from even/settings.ts, which is the one list both
  // this pane and the settings screen on the glasses are drawn from. Adding a
  // setting is adding an entry there.
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
