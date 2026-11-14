import {
  readItem,
  readItems,
  readKeyring,
  readMeta,
  readVersions,
  readVaults,
  write,
  writeKeyring,
  writeMeta,
} from './local'
import type { DeviceRows } from './synced'

export const deviceRows: DeviceRows = {
  keyring: readKeyring,
  writeKeyring,
  vaults: readVaults,
  items: readItems,
  item: readItem,
  versions: readVersions,
  write,
  read: readMeta,
  keep: writeMeta,
}
