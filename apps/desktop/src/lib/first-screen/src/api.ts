export { firstScreen, sameNote, type Kept } from './first-screen.svelte'
export const keepFirstScreens = (shown: import('./keep.svelte').Shown): Promise<void> =>
  import('./keep.svelte').then((one) => one.keepFirstScreens(shown))
