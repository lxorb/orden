import { diverge } from '@orden/sync-core'
export function mergedCleanly(base: string, local: string, remote: string): string | null {
  const judged = diverge(base, local, remote, { local: 0, remote: 0 })
  return judged.verdict === 'clean' ? judged.resolution : null
}
