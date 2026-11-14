import type { Stopping } from '@orden/contracts'
import { invoke, waited } from '../../platform/src/api'
import { rowsHere, showRow } from './rows'

const CHANNEL = 'orden:quitting'

const WAITS = 800

type Message =
  | { kind: 'ask'; asking: string; idle: boolean }
  | { kind: 'said'; asking: string; window: string; rows: Stopping[] }
  | { kind: 'show'; row: Stopping }

let own = ''

export async function rowsEverywhere(window: string, idle: boolean): Promise<Stopping[]> {
  const others = await invoke<string[]>('quit_others').catch(() => [])
  if (!others.length) return rowsHere(window, idle)

  const channel = new BroadcastChannel(CHANNEL)
  const asking = crypto.randomUUID()
  const heard = new Map<string, Stopping[]>()
  const all = new Promise<void>((resolve) => {
    channel.onmessage = ({ data }: MessageEvent<Message>) => {
      if (data.kind !== 'said' || data.asking !== asking) return
      heard.set(data.window, data.rows)
      if (others.every((one) => heard.has(one))) resolve()
    }
  })
  channel.postMessage({ kind: 'ask', asking, idle } satisfies Message)

  const [here] = await Promise.all([rowsHere(window, idle), Promise.race([all, waited(WAITS)])])
  channel.close()
  return [...here, ...others.flatMap((one) => heard.get(one) ?? [])]
}

export function showElsewhere(row: Stopping) {
  const channel = new BroadcastChannel(CHANNEL)
  channel.postMessage({ kind: 'show', row } satisfies Message)
  channel.close()
}

export function answer(window: string) {
  own = window
  const channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = ({ data }: MessageEvent<Message>) => {
    if (data.kind === 'ask') {
      void rowsHere(own, data.idle).then((rows) =>
        channel.postMessage({
          kind: 'said',
          asking: data.asking,
          window: own,
          rows,
        } satisfies Message),
      )
    } else if (data.kind === 'show' && data.row.window === own) {
      void showRow(data.row)
      void invoke('raise_window', { label: own })
    }
  }
}
