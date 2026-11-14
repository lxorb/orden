import { type Rgb, rgbOf } from '../../../ui-controls/src/api'
import { isNumber, isRecord, isString, keepJson, stored } from '../../../platform/src/api'
import { keysOf } from '../../../web-tab/pages.svelte'

const KEY = 'orden:glass-grounds'

const MOST = 300

type Kept = [colour: string, said: number]

function read(): Map<string, Kept> {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once; what is drawn is `live`
  const held = new Map<string, Kept>()
  const said = stored(KEY)
  if (!isRecord(said)) return held
  for (const [key, one] of Object.entries(said)) {
    if (Array.isArray(one) && isString(one[0]) && rgbOf(one[0]) && isNumber(one[1])) {
      held.set(key, [one[0], one[1]])
    }
  }
  return held
}

class Grounds {
  private live = $state<Record<string, { at: string | null; colour: string | null }>>({})
  private kept: Map<string, Kept> | null = null

  private index(): Map<string, Kept> {
    this.kept ??= read()
    return this.kept
  }

  of(tab: string, address: string | null): Rgb | null {
    const mine = this.live[tab]
    if (mine?.at === address) return mine.colour === null ? null : rgbOf(mine.colour)

    const keys = keysOf(address)
    if (!keys) return null
    for (const key of keys) {
      const found = this.index().get(key)
      if (found) return rgbOf(found[0])
    }
    return null
  }

  last(tab: string): Rgb | null {
    const said = this.live[tab]?.colour
    return said ? rgbOf(said) : null
  }

  heard(tab: string, address: string | null): boolean {
    return this.live[tab]?.at === address
  }

  said(tab: string, address: string | null, colour: string | null): void {
    this.live = { ...this.live, [tab]: { at: address, colour } }

    const keys = keysOf(address)
    if (!keys || colour === null) return
    const index = this.index()
    const now = Date.now()
    for (const key of keys) index.set(key, [colour, now])

    if (index.size > MOST) {
      const oldest = [...index.entries()].sort((one, two) => one[1][1] - two[1][1])
      for (const [key] of oldest.slice(0, index.size - MOST)) index.delete(key)
    }
    keepJson(KEY, Object.fromEntries(index))
  }
}

export const grounds = new Grounds()
