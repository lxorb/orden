import type { Invite } from '@orden/pass/wire'
import type { TrustProblem } from './trust-problem'
import type { WorldFiles } from './file-sync'
import type { KeyringRow } from './local'
import type { Held } from './rows'
import type { Shown } from './shown'
import type { PassApi } from './sync'
import type { DeviceRows } from './synced'

export interface SyncWorld {
  api: PassApi
  rows: DeviceRows
  account: string
  email: string
  exclusive<T>(run: (held: Held | null) => Promise<T>): Promise<T>
  shown(update: Shown): void
  tookKeyring(row: KeyringRow): void
  conflicted(on: boolean): void
  invited(invites: Invite[]): void
  distrusted?: (problem: TrustProblem) => void
  files?: () => Promise<WorldFiles>
}
