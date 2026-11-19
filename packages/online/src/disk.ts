import type { Disk } from './types'

const DISK_NEAR = 0.8
const DISK_FULL = 0.9
const LEFT = 1_000_000_000
export const diskShare = (disk: Disk): number => (disk.total > 0 ? Math.min(1, Math.max(0, disk.used / disk.total)) : 0)
export const diskNear = (disk: Disk): boolean => disk.total > 0 && diskShare(disk) >= DISK_NEAR
export const diskFull = (disk: Disk): boolean =>
  disk.total > 0 && (diskShare(disk) >= DISK_FULL || disk.total - disk.used < LEFT)
