import type { Row } from '@orden/bases'

export interface Pressed {
  act: 'done' | 'open'
  space: string
  path: string
  hash: string
  line: number
}

export interface Host {
  rootOf(space: string): string | null
  rowsAt(path: string): readonly Row[]
  ready(): Promise<void>
  tick(row: Row): Promise<boolean>
  open(root: string, path: string, line: number): Promise<void>
  inside(root: string, path: string): string
}

export async function respond(press: Pressed, host: Host): Promise<boolean> {
  const root = host.rootOf(press.space)
  if (root === null) return false

  await host.ready()
  const full = host.inside(root, press.path)
  const row = host
    .rowsAt(full)
    .find((one) => one.kind === 'task' && one.anchor?.hash === press.hash)

  if (press.act === 'open') {
    await host.open(root, full, row?.anchor?.line ?? press.line)
    return true
  }
  if (!row?.task || row.task.done || row.task.cancelled) return false
  return host.tick(row)
}

export function pressOf(value: unknown): Pressed | null {
  if (typeof value !== 'object' || value === null) return null
  const one = value as Record<string, unknown>
  const { act, space, path, hash, line } = one
  if (act !== 'done' && act !== 'open') return null
  if (typeof space !== 'string' || typeof path !== 'string' || typeof hash !== 'string') {
    return null
  }
  return { act, space, path, hash, line: typeof line === 'number' ? line : 0 }
}
