export { frameOf } from './frame'
export { hostApps } from './host.svelte'
export { makeApplication } from './make'
export { openApplication } from './open'
export { type AppSession, appSessionIfAny } from './session.svelte'

export const loadApplicationTab = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no application in the Even Realities plugin'))
    : import('./ApplicationTab.svelte')
