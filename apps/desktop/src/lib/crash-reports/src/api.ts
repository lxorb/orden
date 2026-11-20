import './shell-parts'
export { crashReports } from './choice.svelte'
export const watchCrashes = (send: boolean): Promise<() => void> =>
  import('./watch.svelte').then((one) => one.watchForCrashes(send))
export const loadCrashAsk = () => import('./CrashAsk.svelte')
