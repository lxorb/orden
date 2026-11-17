export { usageChoice } from './choice.svelte'
export { changed, ran, stepped } from './tally'

export const watchUsage = (send: boolean): Promise<() => void> =>
  __EVEN_PLUGIN__
    ? Promise.resolve(() => undefined)
    : import('./watch.svelte').then((one) => one.watchUsage(send))
