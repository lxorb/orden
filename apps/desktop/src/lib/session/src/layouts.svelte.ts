import { isRecord, isString, Kept } from '../../platform/src/api'
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
  const read = value.map(readSaved).filter((one): one is Saved => one !== null)
  return read
    .filter((one, at) => !read.slice(at + 1).some((later) => later.name === one.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MOST)
}
export class Layouts {
  private keeping = new Kept(STORAGE_KEY, readAll)
  get all(): Saved[] {
    return this.keeping.value
  }
  restore() {
    this.keeping.reread()
  }
  save(name: string, layout: Layout) {
    const clean = name.trim().slice(0, LONGEST_NAME)
    if (!clean) return
    const kept: Saved = { name: clean, layout: withoutText(layout) }
    const rest = this.all.filter((one) => one.name !== clean)
    if (rest.length >= MOST) return
    this.write([...rest, kept].sort((a, b) => a.name.localeCompare(b.name)))
  }
  remove(name: string) {
    this.write(this.all.filter((one) => one.name !== name))
  }
  of(name: string): Layout | null {
    return this.all.find((one) => one.name === name)?.layout ?? null
  }
  private write(all: Saved[]) {
    this.keeping.value = all
    this.keeping.write()
  }
}
