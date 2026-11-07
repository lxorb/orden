export interface FileWaiting {
  item: string
  file: string
  parts: number
  gone: string | null
}

export interface QueueRows {
  read(key: string): Promise<unknown>
  keep(key: string, value: unknown): Promise<void>
}

const WAITING = 'files-waiting'

function waitingIn(value: unknown): FileWaiting | null {
  if (typeof value !== 'object' || value === null) return null
  const { item, file, parts, gone } = value as Record<string, unknown>
  if (typeof item !== 'string' || typeof file !== 'string') return null
  if (typeof parts !== 'number' || !Number.isInteger(parts) || parts < 1) return null
  if (gone !== null && typeof gone !== 'string') return null
  return { item, file, parts, gone }
}

const same = (a: FileWaiting, b: FileWaiting) =>
  a.item === b.item && a.file === b.file && a.gone === b.gone

export async function waitingFiles(rows: QueueRows): Promise<FileWaiting[]> {
  const kept = await rows.read(WAITING)
  if (!Array.isArray(kept)) return []
  return kept.flatMap((one) => waitingIn(one) ?? [])
}

async function changed(
  rows: QueueRows,
  next: (all: FileWaiting[]) => FileWaiting[],
): Promise<void> {
  const after = next(await waitingFiles(rows))
  await rows.keep(WAITING, after.length ? after : null)
}

export async function queuedUpload(
  rows: QueueRows,
  item: string,
  file: string,
  parts: number,
): Promise<void> {
  await changed(rows, (all) => [...all, { item, file, parts, gone: null }])
}

export async function queuedRemoval(
  rows: QueueRows,
  vault: string,
  item: string,
  file: string,
): Promise<void> {
  await changed(rows, (all) => {
    const upload = all.some((one) => one.item === item && one.file === file && one.gone === null)
    const rest = all.filter((one) => !(one.item === item && one.file === file))
    return upload ? rest : [...rest, { item, file, parts: 1, gone: vault }]
  })
}

export async function settledWaiting(rows: QueueRows, done: FileWaiting): Promise<void> {
  await changed(rows, (all) => all.filter((one) => !same(one, done)))
}

export async function droppedWaiting(rows: QueueRows, items: readonly string[]): Promise<void> {
  const gone = new Set(items)
  await changed(rows, (all) => all.filter((one) => one.gone !== null || !gone.has(one.item)))
}
