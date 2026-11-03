import type * as Real from './flat-colour-places'

/** The plugin's twin of flat-colour-places.ts. The plugin carries no coloured drawings
 *  (vite.even.config.ts leaves their file out), so it has nothing to place among the
 *  emoji either: seven kilobytes of names for a set that is not there. */
export const SAME: typeof Real.SAME = {}
export const BESIDE: typeof Real.BESIDE = {}
export const LOOSE: typeof Real.LOOSE = {}
