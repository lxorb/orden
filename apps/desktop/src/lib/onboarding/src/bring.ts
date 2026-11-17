import { type ImportBringPort, portOf } from '@orden/contracts'

const NOTHING: ImportBringPort = {
  here: () => Promise.resolve(new Set()),
  browser: () => Promise.resolve([]),
  notes: () => Promise.resolve({ picked: false, trouble: null }),
  shared: () => Promise.resolve(null),
  landShared: () => Promise.resolve(null),
}

export function bringing(): ImportBringPort {
  const port = portOf('import.bring')
  return port.ok ? port.value : NOTHING
}
