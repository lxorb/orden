import { isRecord, isString, keepJson, stored } from '../platform/src/api'
import { type Layout, readLayout, withoutText } from './session'

const STORAGE_KEY = 'orden:layouts'

const MOST = 20
const LONGEST_NAME = 60

export interface Saved {
  name: string
  layout: Layout
}

function readSaved(value: unknown): Saved | null {
  if (!isRecord(value) || !isString(value.name)) return null

  const layout = readLayout(value.layout)
  return layout && value.name.trim() ? { name: value.name, layout } : null
}

function readAll(value: unknown): Saved[] {
  if (!Array.isArray(value)) return []

  return value
    .map(readSaved)
    .filter((one): one is Saved => one !== null)
    .slice(0, MOST)
}

export class Layouts {
  all = $state<Saved[]>([])

  restore() {
    this.all = readAll(stored(STORAGE_KEY))
  }

  save(name: string, layout: Layout) {
    const clean = name.trim().slice(0, LONGEST_NAME)
    if (!clean) return

    const kept: Saved = { name: clean, layout: withoutText(layout) }
    const rest = this.all.filter((one) => one.name !== clean)
    if (rest.length >= MOST) return

    this.all = [...rest, kept].sort((a, b) => a.name.localeCompare(b.name))
    this.write()
  }

  remove(name: string) {
    this.all = this.all.filter((one) => one.name !== name)
    this.write()
  }

  of(name: string): Layout | null {
    return this.all.find((one) => one.name === name)?.layout ?? null
  }

  private write() {
    keepJson(STORAGE_KEY, this.all)
  }
}
