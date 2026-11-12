import { leftByAnother, leftGone } from '../left-spaces'
import { log } from '../log'
import { prompt } from '../prompt.svelte'
import { samePath } from '../space-paths'
import { windows } from '../windows'
import { workspace } from '../workspace.svelte'
import type { Engine } from './engine'

export function ownRoots(accountId: string | null): string[] {
  return workspace.spaces
    .map((space) => space.root)
    .filter((root) => !leftByAnother(root, accountId))
}

export async function unsentRoots(
  engine: Engine,
  roots: readonly string[],
  done: (id: string) => Promise<boolean>,
): Promise<string[]> {
  const unsent: string[] = []
  for (const root of roots) {
    const space = [...engine.core.spaces.values()].find((one) => samePath(one.row.root, root))
    if (!space || !(await done(space.id)) || engine.waiting(space.id)) unsent.push(root)
  }
  return unsent
}

export async function leaveUnsent(): Promise<boolean> {
  const answer = await prompt.choose({
    title: 'Some changes have not reached your account yet',
    detail:
      'They stay in this browser, out of sight of anyone else who signs in here, and go up when you sign in again.',
    options: [
      { id: 'stay', label: 'Cancel' },
      { id: 'leave', label: 'Sign out', danger: true },
    ],
  })
  return answer === 'leave'
}

export async function dropLeft(roots: readonly string[]): Promise<void> {
  for (const root of roots) {
    const space = workspace.spaces.find((one) => samePath(one.root, root))
    try {
      if (space) await workspace.dropSpace(space.id)
      leftGone(root)
    } catch (error) {
      log('warn', `sync: a space signed out of stays in this browser - ${String(error)}`)
    }
  }
  windows.say('spaces-again')
}
