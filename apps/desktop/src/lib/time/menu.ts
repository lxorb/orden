import { t } from '../i18n.svelte'
import type { MenuEntry } from '../menu-item'
import { time } from './time.svelte'

export function trackingMenu(): MenuEntry[] {
  const lanes = time.tracking
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
  ]
}
