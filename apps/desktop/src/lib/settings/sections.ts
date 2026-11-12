import { account } from '../account.svelte'
import { modes } from '../modes.svelte'
import type { Section } from '../settings.svelte'
import { isDesktop } from '../tauri'
import { viewport } from '../viewport.svelte'

export interface Item {
  id: Section
  label: string
}

export const ICONS: Record<string, string> = {
  general:
    'M2 4h2.4M7.6 4H14M2 8h4.4M9.6 8H14M2 12h6.4M11.6 12H14M4.4 4a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M6.4 8a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M8.4 12a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0',
  space:
    'M3 2.5h10a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5zM5 6h6M5 9h4',
  editor: 'M2 12.6l1.6-.4 8-8a1.4 1.4 0 0 0-2-2l-8 8zM2 14.2h12',
  kinds: 'M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM11.25 9v4.5M9 11.25h4.5',
  shortcuts: 'M2 4.5h12v7H2zM4.4 7h.01M6.9 7h.01M9.4 7h.01M11.9 7h.01M5.4 9.4h5.2',
  mobile: 'M5 1.8h6a1 1 0 0 1 1 1v10.4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1zM4 11h8',
  spelling: 'M2 11.5L5.6 3l3.6 8.5M3.4 8.6h4.4M9.6 12.8l1.8 1.7 3.1-3.5',
  markdown: 'M2.5 3.5h11v9h-11zM4.5 10.5V6l2 2.4L8.5 6v4.5M10.5 6v4.5M9 9l1.5 1.5L12 9',
  appearance:
    'M8 1.8a6.2 6.2 0 1 0 0 12.4c.9 0 1.4-.6 1.4-1.3 0-.8-.7-1.2-.7-1.9 0-.5.4-.9 1-.9h1.1a3.4 3.4 0 0 0 3.4-3.4c0-2.8-2.8-4.9-6.2-4.9zM5 7.4a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zM8 5.6a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zM11 7.4a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z',
  glasses:
    'M4.3 9.4a2.7 2.7 0 1 0 0-.1M11.7 9.4a2.7 2.7 0 1 0 0-.1M7 9.4h2M1.6 8L2.6 5.3h2.7M14.4 8l-1-2.7h-2.7',
  account: 'M8 8.4a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8zM2.6 14a5.4 5.4 0 0 1 10.8 0',
  llm: 'M5 2.5h6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8.5L5.5 14v-2.5H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z',
  ai: 'M6 2.2l1.1 2.9L10 6.2 7.1 7.3 6 10.2 4.9 7.3 2 6.2l2.9-1.1zM11.5 9.2l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z',
  agents:
    'M4.5 6h7a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 11.5v-4A1.5 1.5 0 0 1 4.5 6zM8 6V3.6M8 3.4h.01M6.2 9.3v.4M9.8 9.3v.4',
  sync: 'M13.2 7a5.3 5.3 0 0 0-9.1-2.6L2.8 5.7M2.8 9a5.3 5.3 0 0 0 9.1 2.6l1.3-1.3M2.8 3v2.7h2.7M13.2 13v-2.7h-2.7',
  trash:
    'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8M6.5 7v4M9.5 7v4',
  export: 'M8 10.5V2.5M5 5.5L8 2.5l3 3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10',
  import: 'M8 2.5v8M5 7.5l3 3 3-3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10',
  remote: 'M3 2.5h10v4.5H3zM3 9h10v4.5H3zM5.5 4.75h.01M5.5 11.25h.01',
  experimental:
    'M6.5 2h3M7 2v4.2L3.2 12.6a1 1 0 0 0 .9 1.4h7.8a1 1 0 0 0 .9-1.4L9 6.2V2M4.6 10h6.8',
  online: 'M11.7 12.7H6a4.7 4.7 0 1 1 4.5-6h1.2a3 3 0 1 1 0 6zM5 7.7l1.3 1.2L5 10.1M8 10h2',
}

export function sectionGroups(): Item[][] {
  return [
    [
      { id: 'general', label: 'General' },
      ...(__EVEN_PLUGIN__ ? [] : [{ id: 'space' as Section, label: 'Space' }]),
      { id: 'editor', label: 'Editor' },
      { id: 'kinds', label: 'Note types' },
      { id: 'shortcuts', label: 'Shortcuts' },
      ...(viewport.touch || modes.mobileSeen ? [{ id: 'mobile' as Section, label: 'Mobile' }] : []),
      { id: 'spelling', label: 'Spelling' },
      { id: 'markdown', label: 'Markdown' },
      { id: 'appearance', label: 'Appearance' },
      { id: 'ai', label: 'AI' },
      ...(!__EVEN_PLUGIN__ && isDesktop && modes.coder
        ? [{ id: 'remote' as Section, label: 'Remote' }]
        : []),
      ...(!__EVEN_PLUGIN__ && account.user && modes.coder
        ? [{ id: 'online' as Section, label: 'Online terminal' }]
        : []),
      { id: 'experimental', label: 'Experimental' },
    ],
    [
      { id: 'account', label: 'Account' },
      ...(account.user ? [{ id: 'sync' as Section, label: 'Sync' }] : []),
    ],
    [
      { id: 'trash', label: 'Recently deleted' },
      ...(__EVEN_PLUGIN__ ? [] : [{ id: 'import' as Section, label: 'Import' }]),
      { id: 'export', label: 'Export' },
    ],
  ]
}
