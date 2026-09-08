import { key, t } from './i18n.svelte'
import { prompt } from './prompt.svelte'
import { roleOf, share } from './sharing.svelte'
import { type Space, workspace } from './workspace.svelte'

/** Asks for a name and makes the space. Where it lives is the app's business,
 *  so that is the only question. */
export async function newSpace() {
  const name = await prompt.ask({
    title: t('Name the space'),
    placeholder: t('Journal'),
    confirmLabel: key('Create'),
  })

  if (!name) return
  await workspace.addSpace(name)

  // Until a pass has put it on the account there is nothing to share or to
  // publish, and a quiet loop can be a minute from its next one. Somebody who
  // has just made a space should not have to wait that out to share it.
  const { sync } = await import('./sync.svelte')
  sync.nudge()
}

/** Moves a space in the rail and tells the account about it, so the order is
 *  the same on the next machine. Lives here rather than on the workspace,
 *  which knows nothing about syncing. */
export async function moveSpace(id: string, beforeId: string | null) {
  if (!workspace.moveSpace(id, beforeId)) return

  const { sync } = await import('./sync.svelte')
  void sync.pushSpaceOrder()
}

export async function renameSpace(space: Space) {
  const name = await prompt.ask({
    title: t('Rename the space'),
    value: space.name,
    confirmLabel: key('Rename'),
  })

  if (!name) return

  const from = space.root
  await workspace.renameSpace(space.id, name)

  // The folder has a new path now, and the mirror is keyed by the old one.
  // Left alone, the next pass would read this as a space the account has never
  // seen and upload a second copy of it.
  const { sync } = await import('./sync.svelte')
  await sync.renamed(from, space.root, space.name)
}

/** Who else may reach a space, and at what. The one sheet; see ShareSheet.svelte. */
export async function shareSpace(space: Space) {
  await share.show(space)
}

/** Deleting a space, or letting go of one somebody shared, which is the same
 *  gesture and a different sentence: a space that is not yours is not yours to
 *  delete, and leaving it takes its notes off this machine and nowhere else. */
export async function deleteSpace(space: Space) {
  const theirs = roleOf(space.root) !== 'owner'

  const sure = await prompt.confirm({
    title: theirs
      ? t('Leave {name}?', { name: space.name })
      : t('Delete {name}?', { name: space.name }),
    detail: theirs
      ? t('It stays with everybody else. Its notes go from your computer.')
      : t('Every note in this space is deleted from your computer.'),
    confirmLabel: theirs ? key('Leave') : key('Delete'),
    danger: true,
  })

  if (!sure) return

  const root = space.root
  await workspace.deleteSpace(space.id)

  // Deleted here means deleted from the account. Anything less and the next
  // pass downloads it straight back, here and on every other machine.
  const { sync } = await import('./sync.svelte')
  await sync.forget(root)
}
