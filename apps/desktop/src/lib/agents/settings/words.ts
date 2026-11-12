import type { Category, Scope, SiteRule } from '../verbs'
import type { Limit, ScopeGroup } from './grant'

export const GROUP_WORDS: Record<ScopeGroup, () => string> = {
  notes: () => 'Notes',
  chats: () => 'Chats',
  workspace: () => 'Workspace',
  browser: () => 'Browser',
  tabs: () => 'Your tabs',
  scripts: () => 'Scripts',
  settings: () => 'Settings',
  terminal: () => 'Terminal',
  files: () => 'Files',
  processes: () => 'Programs',
  network: () => 'Web requests',
  clipboard: () => 'Clipboard',
  questions: () => 'Questions',
  editor: () => 'Editor',
  applications: () => 'Applications',
  helpers: () => 'Helpers',
}

export const SCOPE_WORDS: Record<Scope, () => string> = {
  'notes.read': () => 'Read notes',
  'notes.write': () => 'Change notes',
  'chats.read': () => 'Read chats',
  'chats.write': () => 'Post in chats',
  context: () => 'See what you are looking at',
  tree: () => 'Move and rename files',
  workspace: () => 'Open tabs and Essentials',
  'workspace.focus': () => 'Bring a tab to the front',
  browser: () => 'Browse in tabs of its own',
  'browser.network': () => 'Read what pages load',
  'browser.reader': () => 'Act in your tabs',
  'browser.storage': () => 'Read your cookies',
  'browser.script': () => 'Run scripts in pages',
  settings: () => 'Change settings',
  terminal: () => 'Run commands',
  files: () => 'Read and change files anywhere on this computer',
  processes: () => 'Run programs on this computer',
  network: () => 'Send requests to any site, outside your tabs',
  clipboard: () => 'Read and change the clipboard',
  ask: () => 'Ask you a question or tell you something',
  editor: () => 'Select, mark and fold in your notes',
  applications: () => 'Start, see and use your applications',
  agents: () => 'Start helpers on your AI accounts',
}

export const CATEGORY_WORDS: Record<Category, () => string> = {
  paying: () => 'Paying',
  sending: () => 'Sending messages',
  publishing: () => 'Publishing and sharing',
  deleting: () => 'Deleting for good',
  signing_in: () => 'Signing in',
  settings: () => 'Changing settings',
  terminal: () => 'Commands not on its list',
  files: () => 'Files from outside your spaces',
  writing: () => 'Every change',
  trashing: () => 'Every change',
  unread: () => 'Every change',
  showing: () => 'Showing its tabs',
  takeover: () => 'Handing a tab to you',
  pairing: () => 'Connect',
}

export const RULE_WORDS: Record<SiteRule, () => string> = {
  allow: () => 'Allowed',
  deny: () => 'Blocked',
  'agent-store': () => 'Without your logins',
}

export const LIMIT_WORDS: Record<Limit, () => string> = {
  tabs: () => 'Tabs',
  calls: () => 'Calls a minute',
  navigations: () => 'Pages a minute',
  memory: () => 'Browser memory limit',
}

export function limitValue(limit: Limit, value: number): string {
  if (limit !== 'memory') return String(value)
  return value === 0 ? 'Off' : `${String(Math.round((value / 1024) * 10) / 10)} GB`
}
