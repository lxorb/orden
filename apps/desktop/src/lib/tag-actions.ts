import { key, message, t } from './i18n.svelte'
import { settings } from './settings.svelte'
import { isTagName } from '@orden/markdown/tags'
import { liftedFrom, renamedTo, type TagNode } from './tag-tree'
import { workspace } from './workspace.svelte'

export function refusedAsTag(name: string): boolean {
  if (isTagName(name)) return false
  settings.error = t('That tag could not be renamed.')
  return true
}

export async function renameTag(node: TagNode) {
  const { prompt } = await import('./prompt.svelte')

  const typed = await prompt.ask({
    title: t('Rename {tag}', { tag: node.name }),
    value: node.name,
    confirmLabel: key('Rename'),
  })
  if (typed === null) return

  const to = renamedTo(node.path, typed)
  if (!to || to === node.path) return
  if (refusedAsTag(to)) return

  try {
    await workspace.retagNotes(node.path, to)
  } catch (error) {
    settings.error = message(error, key('That tag could not be renamed.'))
  }
}

export async function removeTag(node: TagNode) {
  const { prompt } = await import('./prompt.svelte')
  const up = liftedFrom(node.path)

  const answer = await prompt.choose({
    title: t('Delete {tag}?', { tag: node.name }),
    options: [
      ...(up ? [{ id: 'up', label: t('Move up to {tag}', { tag: up }), primary: true }] : []),
      { id: 'away', label: key('Remove from every note'), danger: true },
      { id: 'cancel', label: key('Cancel') },
    ],
  })

  if (answer !== 'up' && answer !== 'away') return

  try {
    await workspace.retagNotes(node.path, answer === 'up' ? up : null)
  } catch (error) {
    settings.error = message(error, key('That tag could not be deleted.'))
  }
}
