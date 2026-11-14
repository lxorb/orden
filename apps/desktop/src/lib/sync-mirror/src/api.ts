export { type Answer, type Clash, type ConflictRule, conflictRule, DEFAULT_RULE } from './conflicts'
export {
  type Mirror,
  MIRRORS_KEY,
  type Moving,
  newMirror,
  readMirror,
  savedRecord,
  type Tracked,
  type Untold,
  within,
} from './mirror'
export type { Joined, Waiting } from './pass'
export { record } from './record.svelte'
export type { Folded } from './web-copies'

export const notePass = () => import('./pass')
export const meetingAgain = () => import('./meeting')
export const returning = () => import('./returning')
export const mirrorHolding = () => import('./holding')
export const writingDown = () => import('./write-down')
