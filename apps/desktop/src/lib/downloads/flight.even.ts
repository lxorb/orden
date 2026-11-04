import type * as Real from './flight'

/** The plugin's twin of flight.ts. The glasses and the phone they are paired with have
 *  no downloads glyph to fly to and no web tab saving files, so a download is not flown
 *  there and the flight's code is not carried; see even-contents.ts. */
export const started: typeof Real.started = () => Promise.resolve()
export const stopFlights: typeof Real.stopFlights = () => undefined
