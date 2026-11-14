import { keep, storedText } from '../platform/src/api'
import { isSaver, type Saver } from './resting'

const KEY = 'orden:memory-saver'

class MemorySaver {
  mode = $state<Saver>(read())

  set(mode: Saver) {
    this.mode = mode
    keep(KEY, mode)
  }
}

function read(): Saver {
  const kept = storedText(KEY)
  return isSaver(kept) ? kept : 'off'
}

export const saver = new MemorySaver()
