export { swipeChoice } from './choice.svelte'
export { swiping } from './shown.svelte'

export const listenSwipes = (): Promise<() => void> =>
  __EVEN_PLUGIN__
    ? Promise.resolve(() => undefined)
    : import('./swipes').then((one) => one.listen())
