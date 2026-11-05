import { canWriteAt, isShared, roleOf } from '../sharing.svelte'
import { workspace } from '../workspace.svelte'
import { rememberInbox } from './inbox'

export function homeOf(
  spaces: readonly { root: string }[],
  owns: (root: string) => boolean,
  alone: (root: string) => boolean,
  writable: (root: string) => boolean,
): string | null {
  const mine = spaces.filter((one) => writable(one.root))
  return (
    mine.find((one) => owns(one.root) && alone(one.root))?.root ??
    mine.find((one) => owns(one.root))?.root ??
    mine[0]?.root ??
    null
  )
}

export function homeRoot(): string | null {
  return homeOf(
    workspace.shownSpaces,
    (root) => roleOf(root) === 'owner',
    (root) => !isShared(root),
    canWriteAt,
  )
}

export function tellHome(): () => void {
  return $effect.root(() => {
    $effect(() => rememberInbox(homeRoot()))
  })
}
