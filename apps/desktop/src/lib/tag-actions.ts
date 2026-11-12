import { message } from './message'
import { settings } from './settings.svelte'
import { isTagName } from '@orden/markdown/tags'
import { liftedFrom, renamedTo, type TagNode } from './tag-tree'
import { workspace } from './workspace.svelte'

export function refusedAsTag(name: string): boolean {
  if (isTagName(name)) return false
  settings.error = 'That tag could not be renamed.'
  return true
}

export async function renameTag(node: TagNode) {
  const { prompt } = await import('./prompt.svelte')

  const typed = await prompt.ask({
    title: `Rename ${node.name}`,
    value: node.name,
    confirmLabel: 'Rename',
  })
  if (typed === null) return

  const to = renamedTo(node.path, typed)
  if (!to || to === node.path) return
  if (refusedAsTag(to)) return

  try {
    await workspace.retagNotes(node.path, to)
  } catch (error) {
    settings.error = message(error, 'That tag could not be renamed.')
  }
}

export async function removeTag(node: TagNode) {
  const { prompt } = await import('./prompt.svelte')
  const up = liftedFrom(node.path)

  const answer = await prompt.choose({
    title: `Delete ${node.name}?`,
    options: [
      ...(up ? [{ id: 'up', label: `Move up to ${up}`, primary: true }] : []),
      { id: 'away', label: 'Remove from every note', danger: true },
      { id: 'cancel', label: 'Cancel' },
    ],
  })

  if (answer !== 'up' && answer !== 'away') return

  try {
    await workspace.retagNotes(node.path, answer === 'up' ? up : null)
  } catch (error) {
    settings.error = message(error, 'That tag could not be deleted.')
  }
}
