import { frontMatterValue } from '@orden/markdown/front-matter'
import {
  isCanvasTarget,
  isChatTarget,
  isPagesTarget,
  isTermTarget,
  isWebTarget,
} from '@orden/markdown/links'
import { SvelteMap } from 'svelte/reactivity'
import { saysNothing } from '@orden/scan/note'
import { ICON_COLOUR_KEY, ICON_KEY } from './icons'
import { isMarkdownPath, noteName, pathKey, within, invoke } from './platform/src/api'
import { readWebFile } from '@orden/scan/shortcut'

interface Worn {
  icon: string | null
  iconColor: string | null
  favicon: string | null
  address: string | null
  paper: boolean
  bare: boolean
}

const NOTHING: Worn = {
  icon: null,
  iconColor: null,
  favicon: null,
  address: null,
  paper: false,
  bare: false,
}

function wears(path: string): boolean {
  return (
    isMarkdownPath(path) ||
    isCanvasTarget(path) ||
    isPagesTarget(path) ||
    isWebTarget(path) ||
    isChatTarget(path) ||
    isTermTarget(path)
  )
}

async function wornBy(path: string, content: string): Promise<Worn> {
  if (isWebTarget(path)) {
    const said = readWebFile(path, content)
    return {
      ...NOTHING,
      icon: said?.chosen ?? null,
      iconColor: said?.chosenColour ?? null,
      favicon: said?.icon ?? null,
      address: said?.url ?? null,
    }
  }

  if (isChatTarget(path)) {
    if (__EVEN_PLUGIN__) return NOTHING
    const pointer = (await import('@orden/chats/pointer')).chatOf(content)
    return { ...NOTHING, icon: pointer?.icon ?? null, iconColor: pointer?.iconColor ?? null }
  }

  if (isTermTarget(path)) {
    if (__EVEN_PLUGIN__) return NOTHING
    const term = (await import('@orden/online/term')).termOf(content)
    return { ...NOTHING, icon: term?.icon ?? null, iconColor: term?.iconColor ?? null }
  }

  if (isCanvasTarget(path) || isPagesTarget(path)) {
    const { planeMarks } = await import('@orden/scan/canvas')
    const { icon, iconColor } = planeMarks(content)
    return { ...NOTHING, icon, iconColor }
  }

  return {
    ...NOTHING,
    icon: frontMatterValue(content, ICON_KEY),
    iconColor: frontMatterValue(content, ICON_COLOUR_KEY),
    bare: saysNothing(content, noteName(path)),
  }
}

async function holdsItsPaper(path: string): Promise<boolean> {
  const [{ onDisk }, { paperOf }] = await Promise.all([
    import('./platform/src/api'),
    import('./pages/held'),
  ])
  return onDisk(paperOf(path))
}

class Elsewhere {
  private readonly held = new SvelteMap<string, Worn>()
  private readonly asked = new Map<string, string>()
  private round = 0

  of(path: string): Worn | null {
    if (!wears(path)) return null

    const key = pathKey(path)
    const known = this.held.get(key)
    if (known || this.asked.has(key)) return known ?? null

    this.asked.set(key, path)
    const round = this.round
    queueMicrotask(() => void this.read(path, key, round))
    return null
  }

  private async read(path: string, key: string, round: number) {
    const [content, paper] = await Promise.all([
      invoke<string>('read_note', { path }).catch(() => null),
      !__EVEN_PLUGIN__ && isPagesTarget(path) ? holdsItsPaper(path) : false,
    ])
    const worn = content === null ? NOTHING : await wornBy(path, content)
    if (round === this.round) this.held.set(key, { ...worn, paper })
  }

  saved(path: string, content: string) {
    const key = pathKey(path)
    if (!this.held.has(key) || !wears(path)) return

    const round = this.round
    const paper = this.held.get(key)?.paper ?? false
    void wornBy(path, content).then((worn) => {
      if (round === this.round) this.held.set(key, { ...worn, paper })
    })
  }

  forget(path: string) {
    for (const [key, asked] of [...this.asked]) {
      if (within(path, asked) === null) continue
      this.held.delete(key)
      this.asked.delete(key)
    }
  }

  clear() {
    this.round++
    this.held.clear()
    this.asked.clear()
  }
}

export const elsewhere = new Elsewhere()
