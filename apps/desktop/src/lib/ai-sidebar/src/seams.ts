import { chatCommands } from '../../ai-chat/src/api'
import type { Panel, PanelCommand } from './chat-parts'

export async function commandsFor(panel: Panel): Promise<readonly PanelCommand[]> {
  return (await chatCommands()).commands(panel)
}

const bare = (word: string) => word.toLowerCase().replace(/-/g, '')

export function matching(rows: readonly PanelCommand[], typed: string): PanelCommand[] {
  const want = bare(typed.trim())
  const byName = rows.filter((one) => bare(one.name).startsWith(want))
  const bySynonym = rows.filter(
    (one) => !byName.includes(one) && one.synonyms.some((word) => bare(word).startsWith(want)),
  )
  const byWords = want
    ? rows.filter(
        (one) =>
          !byName.includes(one) &&
          !bySynonym.includes(one) &&
          (one.description ?? '').split(/\s+/).some((word) => bare(word).startsWith(want)),
      )
    : []
  return [...byName, ...bySynonym, ...byWords]
}

export function commandIn(text: string): { name: string; args: string } | null {
  const found = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  return found ? { name: found[1] ?? '', args: (found[2] ?? '').trim() } : null
}

export function rowNamed(
  rows: readonly PanelCommand[],
  name: string,
): { row: PanelCommand; typed?: string } | null {
  const want = name.toLowerCase()
  const own = rows.find((one) => one.name === want)
  if (own) return { row: own }
  const other = rows.find((one) => one.synonyms.includes(want))
  return other ? { row: other, typed: want } : null
}
