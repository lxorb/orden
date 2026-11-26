import { log } from '../../../platform/src/api'

const FORMER_SCRATCHPAD = '/.nib/Scratchpad.md'
export interface ScratchpadFiles {
  read(path: string): Promise<string | null>
  write(path: string, content: string): Promise<unknown>
  remove(path: string): Promise<unknown>
}
export async function carryScratchpad(to: string, files: ScratchpadFiles): Promise<string> {
  const old = await files.read(FORMER_SCRATCHPAD)
  if (old === null) return to
  const written = await files.write(to, old).then(
    () => files.read(to),
    () => null,
  )
  if (written !== old) {
    log('warn', `orden: could not carry the scratchpad to ${to}, so it stays at ${FORMER_SCRATCHPAD}`)
    return FORMER_SCRATCHPAD
  }
  await files.remove(FORMER_SCRATCHPAD)
  return to
}
