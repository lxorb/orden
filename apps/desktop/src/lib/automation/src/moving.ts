import {
  AGENTS_NAME,
  extensionOf,
  folderOf,
  insideSpace,
  isAgentsName,
  joinPath,
  nameOf,
  nameToWrite,
  onDisk,
  samePath,
} from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

export function withExtension(name: string): string {
  return MARKDOWN.test(name) ? name : `${name}.md`
}

export const ONTO_INSTRUCTIONS = 'write_note writes them, and no note is moved onto them'

export function ontoInstructions(root: string, from: string, to: string): boolean {
  if (samePath(from, to, root) || folderOf(to) || !isAgentsName(nameOf(to))) return false
  return folderOf(from) !== '' || !isAgentsName(nameOf(from))
}

export async function movedIn(
  root: string,
  from: string,
  to: string,
  undoing = false,
): Promise<string> {
  if (!undoing && ontoInstructions(root, from, to)) {
    throw new Error(
      `${AGENTS_NAME} at the top of a space is its instructions: ${ONTO_INSTRUCTIONS}`,
    )
  }

  const folder = folderOf(to)
  const name = nameOf(to)
  const source = insideSpace(root, from)
  if (folder === folderOf(from)) {
    await workspace.rename(source, name)
    return to
  }

  const into = folder ? insideSpace(root, folder) : root
  const carried = async (path: string) => {
    if (!(await workspace.moveMany([path], into, undoing))) {
      throw new Error(`the move of ${from} to ${to} was refused`)
    }
  }
  if (name === nameOf(from)) {
    await carried(source)
    return to
  }

  if (await onDisk(joinPath(into, name))) throw new Error(`${to} is already there`)

  const here = folderOf(source)
  const free = async (folderAt: string, called: string) =>
    !(samePath(folderAt, root) && isAgentsName(called)) &&
    !(await onDisk(joinPath(folderAt, called)))

  if (await free(into, nameOf(from))) {
    await carried(source)
    await workspace.rename(joinPath(into, nameOf(from)), name)
    return to
  }
  if (await free(here, name)) {
    await workspace.rename(source, name)
    await carried(joinPath(here, name))
    return to
  }

  let number = 2
  const numbered = () => name.replace(/(\.[^.]*)?$/, ` ${number}$1`)
  while (!(await free(here, numbered())) || !(await free(into, numbered()))) number++
  const aside = numbered()
  await workspace.rename(source, aside)
  await carried(joinPath(here, aside))
  await workspace.rename(joinPath(into, aside), name)

  return to
}

export function movedPath(from: string, to: string, folder = false): string {
  const name = folder
    ? nameOf(to)
    : MARKDOWN.test(from)
      ? withExtension(nameOf(to))
      : nameToWrite(nameOf(to), extensionOf(nameOf(from), false))
  const into = folderOf(to)
  return into ? `${into}/${name}` : name
}
