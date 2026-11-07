import type { ItemRow as WireItem } from '@orden/pass/wire'
import type { FileApi } from './file-api'
import { FileRefused } from './file-api'
import type { FileWaiting } from './file-queue'
import { droppedWaiting, settledWaiting, waitingFiles } from './file-queue'
import type { FilePartRow } from './local'
import type { SyncWorld } from './sync-world'

export interface WorldFiles {
  api: FileApi
  parts(item: string, file: string): Promise<FilePartRow[]>
  drop(item: string): Promise<void>
}

export type FilesSent = 'sent' | 'again' | 'stuck'

export async function worldFiles(base: string, token: string): Promise<WorldFiles> {
  const [{ fileApi }, { dropFileParts, readFileParts }] = await Promise.all([
    import('./file-api'),
    import('./local'),
  ])
  return { api: fileApi(base, token), parts: readFileParts, drop: (item) => dropFileParts(item) }
}

const LATER = new Set([404, 409])
const NEVER = new Set([400, 403, 413])

async function sentOne(world: SyncWorld, files: WorldFiles, one: FileWaiting): Promise<FilesSent> {
  if (one.gone !== null) {
    await files.api.remove(one.gone, one.item, one.file)
    return 'sent'
  }
  const row = (await world.rows.items()).find((it) => it.id === one.item && !it.deleted)
  if (!row) return 'sent'
  const parts = (await files.parts(one.item, one.file)).sort((a, b) => a.part - b.part)
  if (parts.length !== one.parts) return 'sent'
  for (const part of parts) {
    await files.api.put(row.vault, one.item, one.file, part.part, part.parts, part.bytes)
  }
  return 'sent'
}

export async function pushedFiles(world: SyncWorld): Promise<FilesSent> {
  const files = await world.files?.()
  if (!files) return 'sent'
  let all: FilesSent = 'sent'
  for (const one of await waitingFiles(world.rows)) {
    try {
      await sentOne(world, files, one)
      await world.exclusive(() => settledWaiting(world.rows, one))
    } catch (error) {
      if (!(error instanceof FileRefused) || error.status >= 500) throw error
      if (NEVER.has(error.status)) await world.exclusive(() => settledWaiting(world.rows, one))
      else all = LATER.has(error.status) && all === 'sent' ? 'again' : 'stuck'
    }
  }
  return all
}

export async function forgottenFiles(world: SyncWorld, rows: readonly WireItem[]): Promise<void> {
  const gone = rows.filter((one) => one.deleted).map((one) => one.id)
  const files = gone.length ? await world.files?.() : undefined
  if (!files) return
  const live = new Set(
    (await world.rows.items()).filter((one) => !one.deleted).map((one) => one.id),
  )
  const forgotten = [...new Set(gone)].filter((id) => !live.has(id))
  for (const id of forgotten) await files.drop(id)
  if (forgotten.length) await droppedWaiting(world.rows, forgotten)
}
