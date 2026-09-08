/** What a right click on a tag offers: rename it, or take it away.
 *
 *  Only the questions. What either one writes is tag-edits.ts, and the writing
 *  itself goes out through `retagNotes`, which snapshots every note it touches
 *  and records the lot as one thing to undo. */

import { key, message, t } from './i18n.svelte'
import { settings } from './settings.svelte'
import { liftedFrom, renamedTo, type TagNode } from './tag-tree'
import { workspace } from './workspace.svelte'

/** Renames a node, and everything under it, in every note that mentions it.
 *
 *  A name rather than a whole path is asked for, because a row shows a name and
 *  that is what somebody means by renaming it. A name with slashes in it moves
 *  the node, which is the same gesture and may as well work. */
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

  try {
    await workspace.retagNotes(node.path, to)
  } catch (error) {
    settings.error = message(error, key('That tag could not be renamed.'))
  }
}

/** Takes a node away. What happens to the notes under it is the question: their
 *  tags move up a level, keeping them findable under whatever held this node, or
 *  they lose the tag altogether.
 *
 *  A node at the top has nothing to move up to, so it is only ever the second. */
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
