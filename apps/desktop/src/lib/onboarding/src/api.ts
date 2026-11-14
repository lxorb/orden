export { gate } from './gate.svelte'

export const loadSetup = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no setup in the Even Realities plugin'))
    : import('./Setup.svelte')

export const loadGuide = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no guide in the Even Realities plugin'))
    : import('./Guide.svelte')

export const beginSetup = (signedIn: boolean): Promise<void> =>
  __EVEN_PLUGIN__
    ? Promise.resolve()
    : import('./setup-state.svelte').then((one) => one.setup.begin(signedIn))
