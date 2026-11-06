import { ChangeSet, type Heard, type Text } from '@orden/editor'

type ChangeDesc = ChangeSet['desc']

interface Range {
  from: number
  to: number
}

function written(change: ChangeSet): Range[] {
  const ranges: Range[] = []
  change.iterChangedRanges((_fromA, _toA, from, to) => ranges.push({ from, to }))
  return ranges
}

function mapped(range: Range, change: ChangeSet): Range {
  const from = change.mapPos(range.from, 1)
  return { from, to: Math.max(from, change.mapPos(range.to, -1)) }
}

function touches(change: ChangeSet, ranges: readonly Range[]): boolean {
  let met = false
  change.iterChangedRanges((from, to) => {
    for (const range of ranges) {
      if (from === to ? range.from < from && from < range.to : from < range.to && range.from < to)
        met = true
    }
  })
  return met
}

interface Step {
  ids: readonly string[]
  changes: ChangeSet
  mapped: ChangeDesc | null
}

function carried(step: Step, mapping: ChangeDesc): Step {
  const before = mapping.mapDesc(step.changes, true)
  return {
    ids: step.ids,
    changes: step.changes.map(mapping),
    mapped: step.mapped ? step.mapped.composeDesc(before) : before,
  }
}

function carriedInto(steps: readonly Step[], mapping: ChangeDesc): Step[] {
  let length = steps.length
  let through = mapping

  while (length) {
    const top = steps[length - 1]
    if (!top) break

    const step = carried(top, through)
    if (!step.changes.empty) return [...steps.slice(0, length - 1), step]

    through = step.mapped ?? through
    length--
  }

  return []
}

export class Steps {
  private steps: Step[] = []
  private readonly undone = new Set<string>()

  get size(): number {
    return this.steps.length
  }

  push(ids: readonly string[], changes: ChangeSet, before: Text) {
    this.steps.push({ ids, changes: changes.invert(before), mapped: null })
  }

  saved(): () => void {
    const steps = [...this.steps]
    const undone = [...this.undone]
    return () => {
      this.steps = steps
      this.undone.clear()
      for (const id of undone) this.undone.add(id)
    }
  }

  carry(change: ChangeDesc) {
    if (change.empty || !this.steps.length) return
    this.steps = carriedInto(this.steps, change)
  }

  heard(heard: Heard): boolean {
    const back = heard.marks.filter((mark) => mark.undone).map((mark) => mark.id)
    const again = heard.marks.filter((mark) => !mark.undone).map((mark) => mark.id)

    const top = this.steps.at(-1)
    if (top && back.length && back.some((id) => top.ids.includes(id))) {
      this.pop()
      for (const id of top.ids) this.undone.add(id)
      return true
    }

    if (again.length && again.every((id) => this.undone.has(id))) {
      for (const id of again) this.undone.delete(id)
      this.steps.push({ ids: again, changes: heard.changes.invert(heard.before), mapped: null })
      return true
    }

    return false
  }

  takeAll(): { changes: ChangeSet; ids: string[] } | null {
    let total: ChangeSet | null = null
    const ids: string[] = []

    for (let top = this.pop(); top; top = this.pop()) {
      total = total ? total.compose(top.changes) : top.changes
      ids.push(...top.ids)
    }

    for (const id of ids) this.undone.add(id)
    return total ? { changes: total, ids } : null
  }

  get ids(): string[] {
    return this.steps.flatMap((step) => [...step.ids])
  }

  take(wanted: ReadonlySet<string>, words: Text): { changes: ChangeSet; ids: string[] } | null {
    const lowest = this.steps.findIndex((step) => step.ids.some((id) => wanted.has(id)))
    if (lowest === -1) return null

    const popped: { step: Step; at: Text }[] = []
    let doc = words
    let total = ChangeSet.empty(words.length)
    while (this.steps.length > lowest) {
      const top = this.pop()
      if (!top) break
      popped.push({ step: top, at: doc })
      total = total.compose(top.changes)
      doc = top.changes.apply(doc)
    }

    const taken: string[] = []
    const again: { ids: readonly string[]; changes: ChangeSet; before: Text }[] = []
    let toNow = ChangeSet.empty(doc.length)
    let hot: { from: number; to: number }[] = []
    let now = doc
    for (const { step, at } of popped.reverse()) {
      const forward = step.changes.invert(at)
      const asked = step.ids.some((id) => wanted.has(id))
      if (asked || touches(forward, hot)) {
        taken.push(...step.ids)
        hot = [...hot.map((range) => mapped(range, forward)), ...written(forward)]
        toNow = step.changes.compose(toNow)
        continue
      }

      const carried = forward.map(toNow)
      again.push({ ids: step.ids, changes: carried, before: now })
      total = total.compose(carried)
      now = carried.apply(now)
      toNow = toNow.map(forward, true)
      hot = hot.map((range) => mapped(range, forward))
    }

    for (const one of again) this.push(one.ids, one.changes, one.before)
    for (const id of taken) this.undone.add(id)
    return { changes: total, ids: taken }
  }

  private pop(): Step | null {
    const top = this.steps.at(-1)
    if (!top) return null

    const rest = this.steps.slice(0, -1)
    this.steps = top.mapped ? carriedInto(rest, top.mapped) : rest
    return top
  }
}
