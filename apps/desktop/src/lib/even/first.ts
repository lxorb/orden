import { markPlugin } from '../plugin'
import { fillLocal, installLocal } from './local'

markPlugin()

const local = installLocal()

export const filling: Promise<void> = fillLocal(local).catch(() => undefined)
