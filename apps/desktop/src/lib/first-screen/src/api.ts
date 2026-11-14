export { firstScreen, sameNote, type Kept } from './first-screen.svelte'

export const keepFirstScreens = (): Promise<void> =>
  __EVEN_PLUGIN__
    ? Promise.resolve()
    : import('./keep.svelte').then((one) => one.keepFirstScreens())
