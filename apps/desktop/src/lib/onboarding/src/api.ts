export { gate } from './gate.svelte'
export const loadSetup = () => import('./Setup.svelte')
export const loadGuide = () => import('./Guide.svelte')
export const beginSetup = (signedIn: boolean): Promise<void> =>
  import('./setup-state.svelte').then((one) => one.setup.start(signedIn))
export const firstSpaceDoor = () => import('./first-space.svelte')
