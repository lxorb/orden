import type { KindName } from '../../gates/src/api'

const NAMES: Record<KindName, string> = {
  note: 'Note',
  canvas: 'Canvas',
  pages: 'Page note',
  chat: 'Chat',
  ai: 'AI chat',
  terminal: 'Terminal',
  remote: 'Remote',
  online: 'Online terminal',
  application: 'Application',
  explorer: 'File explorer',
  pass: 'Pass',
  web: 'Web note',
  private: 'Private tab',
}
const AS_NAMED = new Set<KindName>(['remote', 'online', 'explorer', 'pass'])
export function kindName(kind: KindName): string {
  return NAMES[kind]
}
export function kindLabel(kind: KindName): string {
  return AS_NAMED.has(kind) ? NAMES[kind] : `New ${NAMES[kind].replace(/^[A-Z](?=[a-z])/, (one) => one.toLowerCase())}`
}
