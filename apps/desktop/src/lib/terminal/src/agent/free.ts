import { folderOf, joinPath, onDisk, relativeTo, within } from '../../../platform/src/api'
import { buried, protection } from '../../../protect/src/api'
import { workspace } from '../../../workspace/src/api'
import { type Os, programOf, runsOnTheList } from './shell-text'

const REPOSITORY = ['HEAD', 'objects', 'refs']

async function wholeRepository(git: string): Promise<boolean> {
  const held = await Promise.all(REPOSITORY.map((one) => onDisk(joinPath(git, one))))
  return held.every(Boolean)
}

async function repositoryTop(folder: string, root: string): Promise<string | null> {
  let at = folder
  while (within(root, at, root) !== null) {
    const git = joinPath(at, '.git')
    if (await onDisk(git)) return (await wholeRepository(git)) ? at : null
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
  if (root === undefined || top === null || !protection.agentsMayWithin(top)) return false
  const at = top === root ? '' : relativeTo(root, top)
  return !(await buried()).buriedWithin(root, at)
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
