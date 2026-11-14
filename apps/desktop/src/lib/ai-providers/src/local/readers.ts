import type { LocalKind } from '../providers'
import { claudeReader } from './claude'
import { codexReader } from './codex'
import { geminiReader } from './gemini'
import type { Heard } from './heard'

export function readerOf(kind: LocalKind): (line: string) => Heard {
  if (kind === 'claude-code') return claudeReader()
  if (kind === 'codex') return codexReader()
  return geminiReader()
}
