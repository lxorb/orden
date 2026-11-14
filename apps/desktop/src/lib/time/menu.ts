import { DIVIDER, type MenuEntry } from '../ui-kit/src/api'
import { time } from './time.svelte'

export function trackingMenu(): MenuEntry[] {
  const keeping = () => import('./keeping')
  return [
    {
      label: 'Record what happens',
      checked: time.recording,
      run: () => time.record(!time.recording),
    },
    {
      label: 'Reminders',
      checked: time.reminding,
      run: () => time.remind(!time.reminding),
    },
    DIVIDER,
    { label: 'Export as CSV', run: () => void keeping().then((one) => one.exportCsv()) },
    { label: 'Export as JSON', run: () => void keeping().then((one) => one.exportJson()) },
    { label: 'Import', run: () => void keeping().then((one) => one.importJson()) },
  ]
}
