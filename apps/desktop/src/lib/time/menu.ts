import { t } from '../i18n.svelte'
import { DIVIDER, type MenuEntry } from '../menu-item'
import { time } from './time.svelte'

export function trackingMenu(): MenuEntry[] {
  const keeping = () => import('./keeping')
  return [
    {
      label: t('Record what happens'),
      checked: time.recording,
      run: () => time.record(!time.recording),
    },
    {
      label: t('Reminders'),
      checked: time.reminding,
      run: () => time.remind(!time.reminding),
    },
    DIVIDER,
    { label: t('Export as CSV'), run: () => void keeping().then((one) => one.exportCsv()) },
    { label: t('Export as JSON'), run: () => void keeping().then((one) => one.exportJson()) },
    { label: t('Import'), run: () => void keeping().then((one) => one.importJson()) },
  ]
}
