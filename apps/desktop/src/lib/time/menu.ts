import { t } from '../i18n.svelte'
import { DIVIDER, type MenuEntry } from '../menu-item'
import { time } from './time.svelte'

export function trackingMenu(): MenuEntry[] {
  const lanes = time.tracking
  const keeping = () => import('./keeping')
  return [
    {
      label: t('Time in spaces'),
      checked: lanes.spaces,
      run: () => time.track({ spaces: !lanes.spaces }),
    },
    {
      label: t('Time on websites'),
      checked: lanes.sites,
      run: () => time.track({ sites: !lanes.sites }),
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
