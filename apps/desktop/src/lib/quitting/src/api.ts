export { asWarning, holding, quitAsk } from './state.svelte'
export const mayStop: typeof import('./ask').mayStop = (why) => import('./ask').then((one) => one.mayStop(why))
export const quitAsked = (): Promise<void> => import('./ask').then((one) => one.quitAsked())
export const holdToQuit = (): Promise<void> => import('./ask').then((one) => one.holdToQuit())
export const answerQuitting = (window: string): Promise<void> => import('./windows').then((one) => one.answer(window))
export { hasTray, residency } from './residency.svelte'
