import { startTimer, stopTimer } from './commands'
import { openTime } from './open'
export { trackingMenu } from './menu'
export { openTime }
export { time } from './time.svelte'

export const wakeTime = () => import('./start.svelte').then(() => undefined)
export const loadTimePanel = () => import('./TimePanel.svelte')
export const loadTimeTab = () => import('./TimeTab.svelte')

export const timeCommands = {
  'time.tab': () => void openTime(),
  'time.start': startTimer,
  'time.stop': stopTimer,
}
