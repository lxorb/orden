import type { PaletteHosts } from '@orden/contracts'
import { isDesktop } from '../../platform/src/api'
import { type Destination, destinationOf, type Host, hostFor, said } from './remote/hosts'

let known: readonly Host[] = []

const opening = async () => await import('./remote/open')

async function open(id: string) {
  const one = await opening()
  await one.openRemote(id)
}

async function openAll(ids: readonly string[]) {
  const one = await opening()
  await one.openAll(ids)
}

async function connect(wanted: Destination) {
  const one = await opening()
  await one.connectTo(wanted)
}

export const hosts: PaletteHosts = {
  list: async () => {
    const { remote } = await import('./remote/hosts.svelte')
    await remote.refresh()
    known = remote.hosts
    return known
  },
  wanted: (term) => {
    const wanted = isDesktop ? destinationOf(term) : null
    return wanted && !hostFor(known, wanted) ? { wanted, said: said(wanted) } : null
  },
  open: (id) => void open(id),
  openAll: (ids) => void openAll(ids),
  connect: (wanted) => void connect(wanted),
}
