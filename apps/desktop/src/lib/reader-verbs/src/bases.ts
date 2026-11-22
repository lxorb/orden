import type { Base, Context } from '@orden/bases'
import { AgentError, clockOf, queryBase as queried, readBase } from '@orden/bases/agent'
import { linkContext } from '@orden/bases/links'
import { said, type Said } from '../../automation/src/api'
import { insideSpace, invoke } from '../../platform/src/api'
import { reachedByOthersIn } from '../../sharing/src/api'
import { guardedAt } from './guard'
import { readable, seen } from './guarded'
import { need } from './need'
import { judgedForWriting, type Place } from './places'
import { Refused } from './refused'

export async function rowsStore() {
  const { rows } = await import('../../rows/src/api')
  for (let waited = 0; !rows.ready && waited < 8000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return rows
}
export function refused(error: unknown): never {
  if (error instanceof AgentError) throw new Refused(error.code, error.message)
  throw error
}
export async function contextOf(): Promise<Context> {
  const { account } = await import('../../accounts/src/api')
  return { ...clockOf(new Date()), ...(account.name ? { me: account.name } : {}) }
}
export function sourceOf(places: readonly Place[]): string | null {
  const shared = places.filter((place) => reachedByOthersIn(place.space.root))
  return shared.length ? `shared space ${shared.map((one) => one.space.name).join(', ')}` : null
}
export async function baseAt(
  place: Place,
  asked: string,
): Promise<{ place: Place; relative: string; text: string; base: Base }> {
  const relative = judgedForWriting(asked)
  if (!/\.base$/i.test(relative)) throw new Refused('bad_arguments', `${relative} is not a .base file`)
  readable(insideSpace(place.space.root, relative), relative)
  const text = await invoke<string>('read_note', { path: insideSpace(place.space.root, relative) }).catch(() => null)
  if (text === null) throw new Refused('no_such_file', `there is no ${relative} in ${place.space.name}`)
  try {
    return { place, relative, text, base: readBase(text) }
  } catch (error) {
    const at = /line (\d+), column (\d+)/.exec(String(error))
    const where = at ? ` at line ${at[1] ?? ''}, column ${at[2] ?? ''}` : ''
    throw new Refused('bad_arguments', `${relative} does not read as a base${where}`)
  }
}
async function baseToAnswer(place: Place, asked: string) {
  const found = await baseAt(place, asked)
  const base = guardedAt(found.base, insideSpace(found.place.space.root, found.relative))
  if (!base) throw new Refused('bad_arguments', `${found.relative} could take too long to answer`)
  return { ...found, base }
}
function readYaml(yaml: string): Base {
  try {
    return readBase(yaml)
  } catch (error) {
    throw new Refused('bad_arguments', `the yaml does not read: ${String(error)}`)
  }
}
export async function queryBaseAt(place: Place, args: Said): Promise<{ answer: unknown; source: string | null }> {
  const yaml = said(args, 'yaml')
  const base = yaml === null ? (await baseToAnswer(place, need(args, 'path'))).base : readYaml(yaml)
  const rows = await rowsStore()
  const seenRows = rows.of(place.space.name).filter((row) => seen(insideSpace(place.space.root, row.path)))
  try {
    const answer = queried(base, said(args, 'view') ?? undefined, seenRows, {
      ...(await contextOf()),
      ...linkContext(seenRows),
    })
    return { answer, source: sourceOf([place]) }
  } catch (error) {
    refused(error)
  }
}
