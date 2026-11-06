import type * as Real from './flight'

export const started: typeof Real.started = () => Promise.resolve()
export const stopFlights: typeof Real.stopFlights = () => undefined
