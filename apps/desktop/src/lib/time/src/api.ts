import { startTimer, stopTimer } from './commands'
import { openTime } from './open'
export { trackingMenu } from './menu'
export { openTime }
export { time } from './time.svelte'
export type { Activity, Span } from './records'
export {
  dayTotals,
  type DayTotals,
  moveBlock,
  placeBlock,
  removeBlock,
  resizeBlock,
  setActivity,
  type Slice,
  type Stretch,
  unset,
  type Write,
} from './schedule'
export const wakeTime = () => import('./start.svelte').then(() => undefined)
export const loadTimePanel = () => import('./TimePanel.svelte')
export const loadTimeTab = () => import('./TimeTab.svelte')
export const timeCommands = {
  'time.tab': () => void openTime(),
  'time.start': startTimer,
  'time.stop': stopTimer,
}
