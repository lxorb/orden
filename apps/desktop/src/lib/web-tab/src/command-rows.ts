import type { CommandExtension } from '@orden/contracts'
import { invoke, isDesktop } from '../../platform/src/api'
import { shortcuts } from '../../shortcuts/src/api'
import { workspace } from '../../workspace/src/api'
import { pages, type Step } from './pages.svelte'

async function mute(tab: string, muted: boolean) {
  const { muteSite } = await import('./mute')
  await muteSite(tab, muted)
}

async function clearData(tab: string) {
  const { clearingAsked } = await import('./clearing-asked.svelte')
  clearingAsked.ask(tab)
}

export function webRows(): CommandExtension[] {
  const tab = workspace.active
  if (!isDesktop || tab?.kind !== 'web') return []

  const page = pages.of(tab.id)
  const rows: [Step, string, string][] = [
    ['reload', 'Reload', 'web.reload'],
    ['fresh', 'Hard reload', 'web.fresh'],
  ]
  if (page.loading) rows.push(['stop', 'Stop', 'web.stop'])
  return [
    ...rows.map(([step, label, key]) => ({
      id: `web-${step}`,
      label,
      hint: shortcuts.hint(key),
      run: () => void pages.step(tab.id, step),
    })),
    {
      id: 'web-find',
      label: 'Find',
      hint: shortcuts.hint('edit.find'),
      run: () => (page.find.open = true),
    },
    {
      id: 'web-mute',
      label: page.muted ? 'Unmute site' : 'Mute site',
      hint: shortcuts.hint('web.mute'),
      run: () => void mute(tab.id, !page.muted),
    },
    {
      id: 'web-clear-data',
      label: 'Delete browsing data',
      hint: shortcuts.hint('web.clear-data'),
      run: () => void clearData(tab.id),
    },
    {
      id: 'web-devtools',
      label: 'Developer tools',
      hint: shortcuts.hint('web.devtools'),
      run: () => void invoke('web_devtools', { tab: tab.id }).catch(() => undefined),
    },
  ]
}
