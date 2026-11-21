import { invoke } from '../../platform/src/api'
import { ownKeys } from '../../web-backend/src/api'
import type { Planned } from './plan'

const encoder = new TextEncoder()
const SAME_TIME = 2000
const sameBytes = (one: Uint8Array, two: Uint8Array) =>
  one.length === two.length && one.every((byte, at) => byte === two[at])
async function readBack(path: string): Promise<Uint8Array | null> {
  const bytes = await invoke<ArrayBuffer | number[]>('read_file', { path }).catch(() => null)
  if (bytes === null) return null
  return bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : Uint8Array.from(bytes)
}
async function sameAs(file: Planned, there: Uint8Array): Promise<boolean> {
  if (file.kind === 'file') return sameBytes(file.bytes, there)
  if (sameBytes(encoder.encode(file.text), there)) return true
  const lifted = (await ownKeys()).ownKeysTaken(file.text)
  return lifted !== null && sameBytes(encoder.encode(lifted.text), there)
}
export async function verified(file: Planned, path: string): Promise<string | null> {
  if (file.kind === 'file' && file.pages) return null
  const there = await readBack(path)
  if (there === null) return 'Could not be read back after it was written.'
  if (!(await sameAs(file, there))) return 'What was written differs from the source.'
  if (!file.times) return null
  const stamp = await invoke<{ modified: number } | null>('file_stamp', { path }).catch(() => null)
  if (stamp && Math.abs(stamp.modified - file.times.modified) > SAME_TIME) return 'Lost the date it was last changed.'
  return null
}
