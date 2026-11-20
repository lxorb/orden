export { swipeChoice } from './choice.svelte'
export { swiping } from './shown.svelte'
export const listenSwipes = (): Promise<() => void> => import('./swipes').then((one) => one.listen())
