export { asWarning, quitAsk } from './state.svelte'

export const mayStop: typeof import('./ask').mayStop = (why) =>
  __EVEN_PLUGIN__ ? Promise.resolve(true) : import('./ask').then((one) => one.mayStop(why))

export const quitAsked = (): Promise<void> =>
  __EVEN_PLUGIN__ ? Promise.resolve() : import('./ask').then((one) => one.quitAsked())

export const answerQuitting = (window: string): Promise<void> =>
  __EVEN_PLUGIN__ ? Promise.resolve() : import('./windows').then((one) => one.answer(window))
