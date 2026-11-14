export const AGENT_EVENT = 'orden://agent'

export const BROWSER_VERBS = [
  'browser_tabs',
  'browser_open',
  'browser_navigate',
  'browser_wait',
  'browser_snapshot',
  'browser_find',
  'browser_read',
  'browser_click',
  'browser_type',
  'browser_press',
  'browser_scroll',
  'browser_select',
  'browser_fill_form',
  'browser_hover',
  'browser_drag',
  'browser_upload',
  'browser_screenshot',
  'browser_console',
  'browser_network',
  'browser_evaluate',
  'browser_dialog',
  'browser_downloads',
  'browser_storage',
  'browser_close',
  'browser_show',
  'browser_takeover',
  'files',
  'process',
  'http',
  'system',
  'agent_status',
  'approval_status',
  'agent_pair',
  'agent_bye',
] as const

export type BrowserVerb = (typeof BROWSER_VERBS)[number]

export const AGENT_WINDOW_VERBS: Readonly<Record<string, Scope | null>> = {
  get_context: 'context',
  list_spaces: null,
  list_notes: 'notes.read',
  search_notes: 'notes.read',
  list_backlinks: 'notes.read',
  read_note: 'notes.read',
  list_versions: 'notes.read',
  read_canvas: 'notes.read',
  read_pdf: 'notes.read',
  pdf_highlights: 'notes.read',
  edit_note: 'notes.write',
  write_note: 'notes.write',
  append_note: 'notes.write',
  set_property: 'notes.write',
  set_task: 'notes.write',
  list_tasks: 'notes.read',
  add_task: 'notes.write',
  update_task: 'notes.write',
  query_base: 'notes.read',
  add_row: 'notes.write',
  edit_rows: 'notes.write',
  edit_base: 'notes.write',
  create_note: 'notes.write',
  restore_version: 'notes.write',
  edit_canvas: 'notes.write',
  capture_to_note: 'notes.write',
  attach_agent_log: 'notes.write',
  move_file: 'tree',
  trash_file: 'tree',
  create_folder: 'tree',
  workspace_tabs: 'workspace',
  bookmarks: 'workspace',
  run_command: 'workspace',
  read_setting: null,
  write_setting: 'settings',
  run_terminal: 'terminal',
  read_terminal: 'context',
  type_terminal: 'terminal',
  system_clipboard: 'clipboard',
  ask_reader: 'ask',
  note_editor: 'editor',
  application_tabs: 'applications',
  explorer_tabs: 'files',
  recently_deleted: 'tree',
  list_chats: 'chats.read',
  read_chat: 'chats.read',
  search_chats: 'chats.read',
  draft_message: 'chats.write',
  post_message: 'chats.write',
  react: 'chats.write',
  run_agent: 'agents',
  agent_result: 'agents',
}

export const CRATE_ASKS = {
  readerTabs: 'agent.reader_tabs',
  lend: 'agent.lend',
  storeFor: 'agent.store_for',
  markdown: 'agent.markdown',
} as const

export type Scope =
  | 'context'
  | 'notes.read'
  | 'notes.write'
  | 'chats.read'
  | 'chats.write'
  | 'tree'
  | 'workspace'
  | 'workspace.focus'
  | 'browser'
  | 'browser.reader'
  | 'browser.script'
  | 'browser.network'
  | 'browser.storage'
  | 'settings'
  | 'agents'
  | 'terminal'
  | 'files'
  | 'processes'
  | 'network'
  | 'clipboard'
  | 'ask'
  | 'editor'
  | 'applications'

export type Category =
  | 'paying'
  | 'sending'
  | 'publishing'
  | 'deleting'
  | 'signing_in'
  | 'settings'
  | 'terminal'
  | 'files'
  | 'writing'
  | 'trashing'
  | 'unread'
  | 'showing'
  | 'takeover'
  | 'pairing'

export type SiteRule = 'allow' | 'deny' | 'agent-store'

export interface Grant {
  id: string
  name: string
  client: string
  scopes: Scope[]
  spaces: 'all' | string[]
  sites: Record<string, SiteRule>
  scripts: string[]
  mode: 'unsupervised' | 'confirm'
  asks: Partial<Record<Category, boolean>>
  always: Record<string, Category[]>
  programs: string[]
  limits: { tabs: number; calls: number; navigations: number; memory: number }
  created: number
}

export interface Minted {
  grant: Grant
  token: string
}

export type Code =
  | 'unsupported_on_this_engine'
  | 'bad_arguments'
  | 'not_granted'
  | 'site_denied'
  | 'no_such_tab'
  | 'no_such_ref'
  | 'stopped'
  | 'password_field'
  | 'limit'
  | 'timeout'
  | 'failed'
  | 'no_dialog'
  | 'denied'

export interface Dialog {
  kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload' | 'sign_in' | 'certificate'
  message: string
  default_text?: string
  url: string
  open_ms: number
}

export type Answer =
  | { status: 'ok'; result: unknown; untrusted?: string; dialog?: Dialog }
  | { status: 'needs_approval'; approval: string; summary: string }
  | { status: 'error'; code: Code; message: string; dialog?: Dialog }

export type Store = 'reader' | 'agent' | 'space'

export interface ReaderTab {
  id: string
  title: string
  url: string
  space?: string
  front: boolean
  on_screen: boolean
}

export interface AgentTab {
  id: string
  url: string
  title: string
  loading: boolean
  store: Store
  parked: boolean
}

export interface StoreAsk {
  space?: string
  url: string
}

export interface StoreSaid {
  space: string
  store: string | null
}

export type ApprovalAnswer = 'pending' | 'allowed' | 'denied' | 'expired' | 'done'

export interface Approval {
  id: string
  agent: string
  name: string
  category: Category
  summary: string
  site?: string
  tab?: string
  verb?: string
  asked: number
  answer: ApprovalAnswer
}

export interface Opened {
  tab: string
  store: Store
}

export const AGENT_COMMANDS = [
  'agents_read',
  'agents_write',
  'agents_mint',
  'agents_stop',
  'agents_resume',
  'agents_answer',
  'agents_ask',
  'agents_dialog_path',
  'agents_state',
  'agents_log',
  'agents_log_after',
  'agents_log_days',
  'agents_log_clear',
  'agents_adopt',
  'agents_peek',
  'agents_capture',
  'agents_shell',
  'agents_hold',
] as const

export interface Overview {
  agents: Grant[]
  tabs: [string, AgentTab][]
  approvals: Approval[]
  stopped: boolean
  halted: string[]
  connected: string[]
}

export interface ShellWords {
  show: string
  stop: string
  quit: string
  stopped: string
  closed: string
  hidden: string
  pairing: string
}

export const CAPTURE_AS = ['clip', 'screenshot', 'pdf'] as const
export type CaptureAs = (typeof CAPTURE_AS)[number]

export interface Picture {
  png: string
  width: number
  height: number
}

export interface Captured {
  url: string
  title: string
  html?: string
  png?: string
  pdf?: string
}

export type AgentEvent =
  | { kind: 'acting'; agent: string; tab: string; verb: string }
  | { kind: 'paused'; agent: string }
  | { kind: 'resumed'; agent: string }
  | { kind: 'asked'; approval: Approval }
  | { kind: 'answered'; approval: Approval }
  | { kind: 'tab'; agent: string; id: string; url: string; title: string }
  | { kind: 'closed'; agent: string; id: string }
  | { kind: 'stopped'; closed: boolean }
  | { kind: 'connected'; agents: string[] }
