import { forget, keep, storedText } from '../../platform/src/api'

export function saveOwing(key: string, save: Promise<unknown>): void {
  void save.then(
    () => forget(key),
    () => keep(key, 'yes'),
  )
}

export const owes = (key: string): boolean => storedText(key) === 'yes'
