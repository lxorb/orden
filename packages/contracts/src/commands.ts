import type { CommandExtension } from './shell'

type Runs = Readonly<Record<string, () => void>>

const loads = new Map<string, () => Promise<Runs>>()

function held(key: string, load: () => Promise<Runs>): () => void {
  loads.set(key, load)
  return () => {
    if (loads.get(key) === load) loads.delete(key)
  }
}

export const registerCommands = (space: `${string}.`, load: () => Promise<Runs>): (() => void) =>
  held(space, load)

export const registerCommand = (id: string, load: () => Promise<() => void>): (() => void) =>
  held(id, async () => ({ [id]: await load() }))

export async function runCommand(id: string): Promise<boolean> {
  const load = loads.get(id) ?? loads.get(id.slice(0, id.indexOf('.') + 1))
  const run = load ? (await load().catch(() => null))?.[id] : undefined
  if (!run) return false
  run()
  return true
}

export type CommandPlace =
  | 'send'
  | 'web'
  | 'agent-undo'
  | 'export-picker'
  | 'export'
  | 'record'
  | 'ai-accounts'
  | 'rewrite'
  | 'transcribe'

export type CommandRows = (view: object | undefined) => readonly CommandExtension[]

const rowLoads = new Map<CommandPlace, () => Promise<CommandRows>>()
const rowsLoaded = new Map<CommandPlace, CommandRows>()

export function registerCommandRows(
  place: CommandPlace,
  load: () => Promise<CommandRows>,
): () => void {
  rowLoads.set(place, load)
  rowsLoaded.delete(place)
  return () => {
    if (rowLoads.get(place) !== load) return
    rowLoads.delete(place)
    rowsLoaded.delete(place)
  }
}

export const commandRows = (place: CommandPlace, view?: object): readonly CommandExtension[] =>
  rowsLoaded.get(place)?.(view) ?? []

export async function commandRowsLoaded(): Promise<void> {
  await Promise.all(
    [...rowLoads].map(async ([place, load]) => {
      if (rowsLoaded.has(place)) return
      const rows = await load().catch(() => null)
      if (rows && rowLoads.get(place) === load) rowsLoaded.set(place, rows)
    }),
  )
}
