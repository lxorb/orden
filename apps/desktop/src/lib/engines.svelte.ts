/** The two libraries a note sometimes needs, as something a component can depend on.
 *
 *  KaTeX and the emoji table are loaded when a note turns out to want one rather than
 *  when the app starts; see @nib/markdown/engines, which says why. Everything that
 *  renders a whole note awaits them first, and the editor redraws itself when one
 *  lands - but a canvas keeps the HTML of every card it has drawn, and a card drawn
 *  before the engine arrived is a formula shown as its own source.
 *
 *  So the arrival is a number here, and the canvas puts it in its cache key: a
 *  reader's plane redraws once, in the frame the engine lands, and nothing else in
 *  the app has to know that either library is lazy. See canvas/render.ts. */

import { onEngines } from '@nib/markdown/engines'

let arrived = $state(0)

onEngines(() => {
  arrived += 1
})

/** How many of them have landed. Only worth reading as "has this changed": which
 *  engine it was is nobody's business but the renderer's. */
export function enginesArrived(): number {
  return arrived
}
