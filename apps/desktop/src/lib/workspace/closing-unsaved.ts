import type { Tab } from '../workspace.svelte'
import { hasWords, isDraft } from './drafts'

export function unsavedAmong(closing: readonly Tab[], every: readonly Tab[]): Tab[] {
  const going = new Set(closing.map((one) => one.id))
  const seen = new Set<Tab['note']>()
  return closing.filter((tab) => {
    if (!isDraft(tab.note) || !hasWords(tab.note) || seen.has(tab.note)) return false
    seen.add(tab.note)
    return !every.some((other) => !going.has(other.id) && other.note === tab.note)
  })
}

type Unsaved = 'save' | 'discard' | 'keep'

interface Closing {
  tabs: Tab[]
  save(tab: Tab): Promise<string | null>
  closeAsking(id: string): Promise<void>
}

export async function mayLose(ws: Closing, closing: readonly Tab[]): Promise<boolean> {
  const unsaved = unsavedAmong(closing, ws.tabs)
  const answer = await askUnsaved(unsaved)
  if (answer !== 'save') return answer === 'discard'

  const [only] = unsaved
  if (only && unsaved.length === 1) {
    const { askPlace } = await import('../save-place/door')
    askPlace(only.id, () => void ws.closeAsking(only.id))
    return false
  }
  const saved = await Promise.all(unsaved.map((tab) => ws.save(tab)))
  return saved.every((path) => path !== null)
}

async function askUnsaved(unsaved: readonly Tab[]): Promise<Unsaved> {
  const [only] = unsaved
  if (!only) return 'discard'

  const { prompt } = await import('../prompt.svelte')
  const answer = await prompt.choose({
    title: unsaved.length === 1 ? `Save changes to ${only.shown}?` : 'Save changes to these tabs?',
    detail: 'Unsaved words go to Recently deleted.',
    options: [
      { id: 'keep', label: 'Cancel' },
      { id: 'discard', label: 'Don’t save' },
      { id: 'save', label: 'Save', primary: true },
    ],
  })
  return answer === 'save' || answer === 'discard' ? answer : 'keep'
}
