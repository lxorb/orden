export { putWords, toolPressed, wordsAt } from './actions'
export { type Found, matches } from './find'
export { freeScroll, holdFreeScroll } from './free-scroll'
export { hand } from './hand.svelte'
export { pens } from './pens.svelte'
export { type KeptView } from './place'
export { FORGIVING, inks, type Tool } from './pointer'
export { RightPan } from './right-pan'
export { CanvasStore } from './store.svelte'
export { tools } from './tools.svelte'
export { default as CanvasBar } from './CanvasBar.svelte'
export { default as CanvasFind } from './CanvasFind.svelte'
export { default as CanvasHands } from './CanvasHands.svelte'
export { default as CanvasInk } from './CanvasInk.svelte'
export { default as CanvasNode } from './CanvasNode.svelte'
export { default as CanvasPicked } from './CanvasPicked.svelte'

export const loadCanvas = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no canvas in the Even Realities plugin'))
    : import('./Canvas.svelte')
