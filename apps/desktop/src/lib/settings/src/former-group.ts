import type { Field, Group } from './fields'

const MOST = 44
const TAIL = 26
export function middleCut(path: string, most = MOST, tail = TAIL): string {
  const all = Array.from(path)
  if (all.length <= most) return path
  const end = Math.min(tail, most - 2)
  return `${all.slice(0, most - 1 - end).join('')}…${all.slice(-end).join('')}`
}
export function formerGroups(left: readonly string[], said: { title: string; caption: string } | null): Group[] {
  if (left.length === 0 || said === null) return []
  return [
    {
      title: said.title,
      caption: { text: said.caption },
      fields: left.map((path): Field => ({
        kind: 'value',
        label: middleCut(path),
        hint: path,
        words: ['old', 'folder', 'moved', 'left', 'former', 'data'],
        get: () => 'Show',
        does: `Show ${path}`,
        press: () => void import('../../files-out/src/api').then(({ reveal }) => reveal(path)),
      })),
    },
  ]
}
