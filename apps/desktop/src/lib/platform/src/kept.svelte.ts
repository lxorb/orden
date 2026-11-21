import { heardElsewhere, isRecord, keep, parsed, storedText } from './stored'

const ordered = (_: string, one: unknown) =>
  isRecord(one) ? Object.fromEntries(Object.entries(one).sort(([a], [b]) => a.localeCompare(b))) : one
const textOf = (value: unknown): string | undefined => JSON.stringify(value, ordered)
function joined(mine: unknown[], base: unknown[], theirs: unknown[]) {
  const ours = mine.map(textOf)
  const was = base.map(textOf)
  const held = theirs.map(textOf)
  return [
    ...theirs.filter((_, at) => !was.includes(held[at]) || ours.includes(held[at])),
    ...mine.filter((_, at) => !was.includes(ours[at]) && !held.includes(ours[at])),
  ]
}
export function merged<T>(mine: T, base: T, theirs: T): T {
  if (textOf(mine) === textOf(base)) return theirs
  if (isRecord(mine) && isRecord(base) && isRecord(theirs)) {
    const changed = [...Object.keys(base), ...Object.keys(mine)].filter(
      (key) => textOf(mine[key]) !== textOf(base[key]),
    )
    return Object.fromEntries([
      ...Object.entries(theirs).filter(([key]) => !changed.includes(key)),
      ...Object.entries(mine).filter(([key]) => changed.includes(key)),
    ]) as T
  }
  if (Array.isArray(mine) && Array.isArray(base) && Array.isArray(theirs)) return joined(mine, base, theirs) as T
  return mine
}
export class Kept<T> {
  value = $state.raw<T>(undefined as T)
  private text: string | null
  constructor(
    private key: string,
    private read: (saved: unknown) => T,
    heard?: () => void,
  ) {
    this.text = storedText(key)
    this.value = read(parsed(this.text))
    heardElsewhere([key], () => {
      if (this.reread()) heard?.()
    })
  }
  reread() {
    const now = storedText(this.key)
    if (now === this.text) return false
    const was = this.value
    const base = this.read(parsed(this.text))
    this.value = this.read(merged(was, base, this.read(parsed(now))))
    this.text = now
    return textOf(this.value) !== textOf(was)
  }
  write() {
    this.reread()
    const text = JSON.stringify(this.value)
    this.text = keep(this.key, text) ? text : storedText(this.key)
  }
}
