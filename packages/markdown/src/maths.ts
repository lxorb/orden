/** The formula engine, dressed: KaTeX with the chemistry pack applied.
 *
 *  Its own module, and a tiny one, so that both ways of getting hold of it say the
 *  same thing. `engines.ts` loads this when a note turns out to have a formula in it;
 *  `eager.ts` imports it outright for the Worker. Neither has to remember that the
 *  pack is a second import, and the pack ships no types of its own - which a plain
 *  side-effect import does not mind and a dynamic one would. */

import katex from 'katex'
// Chemical equations: `\ce{H2O}` and friends, as Typora supports. Loading it registers
// the macros on the engine below; there is nothing to name.
import 'katex/contrib/mhchem'

export default katex
