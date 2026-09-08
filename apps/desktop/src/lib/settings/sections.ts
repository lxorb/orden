/** The panes of the settings, and the line drawing each wears.
 *
 *  Data rather than markup, so the panel is left with the navigation and the
 *  search rather than with a list of names as well. Grouped the way a phone
 *  shows them: the preferences, the things an account owns, and getting a note
 *  out. */

import { account } from '../account.svelte'
import { isPlugin } from '../plugin'
import { t } from '../i18n.svelte'
import type { Section } from '../settings.svelte'

export interface Item {
  id: Section
  label: string
}

/** One path each, so the list reads at a glance rather than as a column of
 *  words. */
export const ICONS: Record<string, string> = {
  // Sliders, not a sun with rays: the rail's theme button is already a sun,
  // and adjusting things is what this pane is for.
  general:
    'M2 4h2.4M7.6 4H14M2 8h4.4M9.6 8H14M2 12h6.4M11.6 12H14M4.4 4a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M6.4 8a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M8.4 12a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0',
  editor: 'M2 12.6l1.6-.4 8-8a1.4 1.4 0 0 0-2-2l-8 8zM2 14.2h12',
  // A keyboard: the row of keys is the shortcut, not the writing.
  shortcuts: 'M2 4.5h12v7H2zM4.4 7h.01M6.9 7h.01M9.4 7h.01M11.9 7h.01M5.4 9.4h5.2',
  // A word under the checker's wavy line, with the tick it earns.
  spelling: 'M2 11.5L5.6 3l3.6 8.5M3.4 8.6h4.4M9.6 12.8l1.8 1.7 3.1-3.5',
  markdown: 'M2.5 3.5h11v9h-11zM4.5 10.5V6l2 2.4L8.5 6v4.5M10.5 6v4.5M9 9l1.5 1.5L12 9',
  appearance:
    'M8 1.8a6.2 6.2 0 1 0 0 12.4c.9 0 1.4-.6 1.4-1.3 0-.8-.7-1.2-.7-1.9 0-.5.4-.9 1-.9h1.1a3.4 3.4 0 0 0 3.4-3.4c0-2.8-2.8-4.9-6.2-4.9zM5 7.4a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zM8 5.6a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zM11 7.4a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z',
  // A pair of lenses and the bridge between them, as the plugin's corner draws
  // them.
  glasses:
    'M4.3 9.4a2.7 2.7 0 1 0 0-.1M11.7 9.4a2.7 2.7 0 1 0 0-.1M7 9.4h2M1.6 8L2.6 5.3h2.7M14.4 8l-1-2.7h-2.7',
  account: 'M8 8.4a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8zM2.6 14a5.4 5.4 0 0 1 10.8 0',
  publish:
    'M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8zM1.8 8h12.4M8 1.8c1.6 1.8 2.4 3.9 2.4 6.2S9.6 12.4 8 14.2C6.4 12.4 5.6 10.3 5.6 8S6.4 3.6 8 1.8z',
  llm: 'M5 2.5h6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8.5L5.5 14v-2.5H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z',
  trash:
    'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8M6.5 7v4M9.5 7v4',
  export: 'M8 10.5V2.5M5 5.5L8 2.5l3 3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10',
}

/** The panes, in their groups.
 *
 *  Publishing and the LLM connector are both things an account owns, and both
 *  are off until deliberately turned on. Until there is an account they have
 *  nothing to show but an instruction to sign in, so they stay out of the list
 *  rather than sitting there offering nothing. Glasses is the same argument from
 *  the other side: outside the plugin there are no glasses to set anything
 *  about. */
export function sectionGroups(): Item[][] {
  return [
    [
      { id: 'general', label: t('General') },
      { id: 'editor', label: t('Editor') },
      { id: 'shortcuts', label: t('Shortcuts') },
      { id: 'spelling', label: t('Spelling') },
      { id: 'markdown', label: t('Markdown') },
      { id: 'appearance', label: t('Appearance') },
      // Only in front of a pair of glasses. Spread rather than hidden, so the
      // group closes over the gap instead of leaving one.
      ...(isPlugin() ? [{ id: 'glasses' as Section, label: t('Glasses') }] : []),
    ],
    [
      { id: 'account', label: t('Account') },
      ...(account.user
        ? [
            { id: 'publish' as Section, label: t('Publish') },
            { id: 'llm' as Section, label: t('LLM access') },
          ]
        : []),
    ],
    [
      { id: 'trash', label: t('Recently deleted') },
      { id: 'export', label: t('Export') },
    ],
  ]
}
