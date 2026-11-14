export { crashReports } from './choice.svelte'

export const watchCrashes = (send: boolean): Promise<() => void> =>
  __EVEN_PLUGIN__
    ? Promise.resolve(() => undefined)
    : import('./watch.svelte').then((one) => one.watchForCrashes(send))

export const loadCrashAsk = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no crash reports in the Even Realities plugin'))
    : import('./CrashAsk.svelte')
