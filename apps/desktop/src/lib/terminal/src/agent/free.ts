import { folderOf, joinPath, onDisk, within } from '../../../platform/src/api'
import { protection } from '../../../protect/src/api'
import { workspace } from '../../../workspace/src/api'
import { type Os, programOf, runsOnTheList } from './shell-text'

async function repositoryTop(folder: string, root: string): Promise<string | null> {
  let at = folder
  while (within(root, at, root) !== null) {
    if (await onDisk(joinPath(at, '.git'))) return at
    if (at === root) return null
    at = folderOf(at)
  }
  return null
}

export async function shutNothingFor(program: string, folder: string, os: Os): Promise<boolean> {
  if (!protection.agentsMayWithin(folder)) return false
  if (programOf(program, os).toLowerCase() !== 'git') return true
  const root = workspace.spaces.find((one) => within(one.root, folder, one.root) !== null)?.root
  const top = root ? await repositoryTop(folder, root) : null
  return top !== null && protection.agentsMayWithin(top)
}

export async function runsFree(
  program: string,
  args: readonly string[],
  programs: readonly string[],
  folder: string,
  os: Os,
): Promise<boolean> {
  return runsOnTheList(program, args, programs, os) && (await shutNothingFor(program, folder, os))
}
