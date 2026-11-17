export { deviceCan, deviceName, deviceSays } from './device'
export { noteBehind, protection } from './protection.svelte'
export type { Protection, Way } from './protection.svelte'
export { hashPassword, matches } from './password'
export { DEFAULT_RELOCK, NEVER, RELOCK_MINUTES, unlocks } from './unlocked.svelte'

export const pulled: typeof import('./synced').pulled = (...args) =>
  import('./synced').then((one) => one.pulled(...args))
