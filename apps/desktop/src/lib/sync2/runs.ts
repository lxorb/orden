import type { Excerpt } from '@orden/sync-core'
interface Run {
  text: string
  marked: boolean
}

export function runsOf(excerpt: Excerpt): Run[] {
  const { text } = excerpt
  const spans = excerpt.marks
    .map(([from, to]) => [Math.max(0, from), Math.min(text.length, to)] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0])

  const runs: Run[] = []
  let at = 0
  for (const [from, to] of spans) {
    const start = Math.max(from, at)
    if (to <= start) continue
    if (start > at) runs.push({ text: text.slice(at, start), marked: false })

    const last = runs.at(-1)
    if (last?.marked && start === at) last.text += text.slice(start, to)
    else runs.push({ text: text.slice(start, to), marked: true })
    at = to
  }
  if (at < text.length) runs.push({ text: text.slice(at), marked: false })

  return runs
}
