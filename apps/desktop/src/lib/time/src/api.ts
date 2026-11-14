export { startTimer, stopTimer } from './commands'
export { trackingMenu } from './menu'
export { openTime } from './open'
export { time } from './time.svelte'

export const wakeTime = () => import('./start.svelte').then(() => undefined)

export const loadTimePanel = () => import('./TimePanel.svelte')

export const loadTimeTab = () => import('./TimeTab.svelte')
