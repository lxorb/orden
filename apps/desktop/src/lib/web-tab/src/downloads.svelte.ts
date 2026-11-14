import { downloadStarted } from '../../downloads/src/api'
import { invoke } from '../../platform/src/api'

type DownloadState = 'going' | 'done' | 'failed' | 'cancelled'

export interface Download {
  id: number
  tab: string
  url: string
  name: string
  state: DownloadState
  received: number
  total: number | null
}

const STATES: readonly DownloadState[] = ['going', 'done', 'failed', 'cancelled']

export function readDownload(value: unknown): Download | null {
  if (typeof value !== 'object' || value === null) return null

  const said = value as Record<string, unknown>
  const state = STATES.find((one) => one === said.state)
  if (
    typeof said.id !== 'number' ||
    typeof said.tab !== 'string' ||
    typeof said.url !== 'string' ||
    typeof said.name !== 'string' ||
    state === undefined
  ) {
    return null
  }

  return {
    id: said.id,
    tab: said.tab,
    url: said.url,
    name: said.name,
    state,
    received: typeof said.received === 'number' ? said.received : 0,
    total: typeof said.total === 'number' && said.total > 0 ? said.total : null,
  }
}

export function merged(list: readonly Download[], one: Download): Download[] {
  if (one.state === 'cancelled') return list.filter((each) => each.id !== one.id)
  if (!list.some((each) => each.id === one.id)) return [...list, one]

  return list.map((each) => {
    if (each.id !== one.id) return each
    if (each.state !== 'going' && one.state === 'going') return each
    return one
  })
}

export function progressOf(list: readonly Download[]): number | 'unknown' | null {
  const going = list.filter((one) => one.state === 'going')
  if (going.length === 0) return null

  const sized = going.filter((one) => one.total !== null)
  const total = sized.reduce((sum, one) => sum + (one.total ?? 0), 0)
  if (total === 0) return 'unknown'

  const received = sized.reduce((sum, one) => sum + Math.min(one.received, one.total ?? 0), 0)
  return received / total
}

class Downloads {
  list = $state<Download[]>([])

  heard(one: Download): boolean {
    const fresh = !this.list.some((each) => each.id === one.id)
    this.list = merged(this.list, one)
    if (fresh && one.state !== 'cancelled') downloadStarted(one.name, { tab: one.tab })
    return fresh
  }

  async open(id: number): Promise<void> {
    await invoke('web_download_open', { id }).catch(() => undefined)
  }

  async show(id: number): Promise<void> {
    const path = await invoke<string>('web_download_saved', { id }).catch(() => null)
    if (path === null) return
    const { reveal } = await import('../../reveal')
    await reveal(path)
  }

  async cancel(id: number): Promise<void> {
    await invoke('web_download_cancel', { id }).catch(() => undefined)
  }
}

export const downloads = new Downloads()
