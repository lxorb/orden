import type { ProviderKind } from '../providers'
import { ai } from '../store.svelte'
import { engineFor, type Setup } from '../chat/engine'
import type { Engine, Thread } from '../chat/types'
import { workspace } from '../../workspace.svelte'
import { protection } from '../../protect/src/api'
import { fromOthers } from '../commands/found'
import { instructionsFor } from '../commands/instructions'
import { untrusted } from '../chat/transcript'
import { CITING, cites } from './citations'

const INSTRUCTIONS = ['AGENTS.md', 'CLAUDE.md']

const told = new Map<string, string>()

async function instructionFile(path: string): Promise<string | null> {
  if (!protection.agentsMay(path)) return null
  const text = await workspace.noteText(path).catch(() => null)
  if (!text?.trim()) return null
  return (await fromOthers(path)) ? untrusted(path, text) : text
}

export async function instructionsOf(thread: Thread): Promise<string> {
  const space = workspace.spaces.find((one) => one.id === thread.space)
  const read = space
    ? await Promise.all(INSTRUCTIONS.map((name) => instructionFile(`${space.root}/${name}`)))
    : []
  const commands = await instructionsFor(thread).catch(() => '')
  const said = [
    ...read.filter((one): one is string => !!one),
    ...(commands.trim() ? [commands] : []),
    ...(cites(thread.turns) ? [CITING] : []),
  ]
  const words = said.join('\n\n')
  told.set(thread.id, words)
  return words
}

const setup: Setup = {
  provider: (id) => ai.provider(id),
  instructions: instructionsOf,
}

export function instructionsSent(thread: string): string {
  return told.get(thread) ?? ''
}

export async function engineOf(kind: ProviderKind): Promise<Engine> {
  return await engineFor(kind, setup)
}
