export { usageChoice } from './choice.svelte'
export { changed, ran, stepped } from './tally'
export const watchUsage = (send: boolean): Promise<() => void> =>
  import('./watch.svelte').then((one) => one.watchUsage(send))
