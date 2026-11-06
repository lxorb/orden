import { t } from '../../i18n.svelte'
import type { Category, Scope, SiteRule } from '../verbs'
import type { Limit, ScopeGroup } from './grant'

export const GROUP_WORDS: Record<ScopeGroup, () => string> = {
  notes: () => t('Notes'),
  chats: () => t('Chats'),
  workspace: () => t('Workspace'),
  browser: () => t('Browser'),
  tabs: () => t('Your tabs'),
  scripts: () => t('Scripts'),
  settings: () => t('Settings'),
  terminal: () => t('Terminal'),
  files: () => t('Files'),
  processes: () => t('Programs'),
  network: () => t('Web requests'),
  clipboard: () => t('Clipboard'),
  questions: () => t('Questions'),
  editor: () => t('Editor'),
  applications: () => t('Applications'),
  helpers: () => t('Helpers'),
}

export const SCOPE_WORDS: Record<Scope, () => string> = {
  'notes.read': () => t('Read notes'),
  'notes.write': () => t('Change notes'),
  'chats.read': () => t('Read chats'),
  'chats.write': () => t('Post in chats'),
  context: () => t('See what you are looking at'),
  tree: () => t('Move and rename files'),
  workspace: () => t('Open tabs and Essentials'),
  'workspace.focus': () => t('Bring a tab to the front'),
  browser: () => t('Browse in tabs of its own'),
  'browser.network': () => t('Read what pages load'),
  'browser.reader': () => t('Act in your tabs'),
  'browser.storage': () => t('Read your cookies'),
  'browser.script': () => t('Run scripts in pages'),
  settings: () => t('Change settings'),
  terminal: () => t('Run commands'),
  files: () => t('Read and change files anywhere on this computer'),
  processes: () => t('Run programs on this computer'),
  network: () => t('Send requests to any site, outside your tabs'),
  clipboard: () => t('Read and change the clipboard'),
  ask: () => t('Ask you a question or tell you something'),
  editor: () => t('Select, mark and fold in your notes'),
  applications: () => t('Start, see and use your applications'),
  agents: () => t('Start helpers on your AI accounts'),
}

export const CATEGORY_WORDS: Record<Category, () => string> = {
  paying: () => t('Paying'),
  sending: () => t('Sending messages'),
  publishing: () => t('Publishing and sharing'),
  deleting: () => t('Deleting for good'),
  signing_in: () => t('Signing in'),
  settings: () => t('Changing settings'),
  terminal: () => t('Commands not on its list'),
  files: () => t('Files from outside your spaces'),
  writing: () => t('Every change'),
  trashing: () => t('Every change'),
  unread: () => t('Every change'),
  showing: () => t('Showing its tabs'),
  takeover: () => t('Handing a tab to you'),
  pairing: () => t('Connect'),
}

export const RULE_WORDS: Record<SiteRule, () => string> = {
  allow: () => t('Allowed'),
  deny: () => t('Blocked'),
  'agent-store': () => t('Without your logins'),
}

export const LIMIT_WORDS: Record<Limit, () => string> = {
  tabs: () => t('Tabs'),
  calls: () => t('Calls a minute'),
  navigations: () => t('Pages a minute'),
  memory: () => t('Browser memory limit'),
}

export function limitValue(limit: Limit, value: number): string {
  if (limit !== 'memory') return String(value)
  return value === 0 ? t('Off') : `${String(Math.round((value / 1024) * 10) / 10)} GB`
}
