import { isBoolean, keepJson, stored } from '../../stored'
import type { Thread } from '../chat/types'
import { foundNamed, rootOfSpace, wordsOf } from './found'
import { actsAlone } from '../modes'

interface Kept {
  style?: string
  agent?: string
}

export type Held = Thread & Kept

export const STYLES: Readonly<Record<string, string>> = {
  default: '',
  concise:
    'Answer as briefly as the question allows: no preamble, no recap, no lists where a sentence will do.',
  explanatory:
    'Explain your reasoning as you go: why each step, what you considered and left out, in plain words.',
  teaching:
    'Teach rather than do: explain the idea, show one small step, and leave the next one for the reader to try.',
}

const MEMORY_KEY = 'orden:ai-memory'

function remembers(): boolean {
  const value = stored(MEMORY_KEY)
  return isBoolean(value) ? value : true
}

export function setRemembers(on: boolean): void {
  keepJson(MEMORY_KEY, on)
}

const REMEMBERING = [
  'When the reader asks you to remember something, or you learn a lasting preference of theirs,',
  'append it as one line under a `## Memory` heading in AGENTS.md at the root of the space',
  '(make the heading, or the note, if there is none), with edit_note. Never keep it anywhere else.',
].join(' ')

async function styleLine(style: string | undefined, root: string | null): Promise<string> {
  if (!style) return ''
  if (style in STYLES) return STYLES[style] ?? ''
  return root ? await wordsOf(await foundNamed('output-style', style, root)) : ''
}

export async function instructionsFor(thread: Thread): Promise<string> {
  const held = thread as Held
  const root = rootOfSpace(thread.space)
  const profile = held.agent && root ? await foundNamed('agent', held.agent, root) : null
  const lines = [
    await wordsOf(profile),
    await styleLine(held.style, root),
    remembers() && actsAlone(thread.mode) ? REMEMBERING : '',
  ]
  return lines.filter(Boolean).join('\n\n')
}
