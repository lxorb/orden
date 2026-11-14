import { nameOf } from '../../platform/src/api'

const VERBS: Record<string, string> = {
  read_note: 'Read',
  read_canvas: 'Read',
  read_pdf: 'Read',
  browser_read: 'Read',
  browser_snapshot: 'Read',
  browser_find: 'Read',
  browser_screenshot: 'Read',
  browser_console: 'Read',
  browser_network: 'Read',
  browser_downloads: 'Read',
  search_notes: 'Searched',
  list_notes: 'Listed',
  list_spaces: 'Listed',
  list_backlinks: 'Listed',
  list_versions: 'Listed',
  browser_tabs: 'Listed',
  workspace_tabs: 'Listed',
  bookmarks: 'Listed',
  get_context: 'Checked',
  agent_status: 'Checked',
  approval_status: 'Checked',
  read_setting: 'Checked',
  edit_note: 'Edited',
  write_note: 'Edited',
  append_note: 'Edited',
  set_property: 'Edited',
  set_task: 'Edited',
  edit_canvas: 'Edited',
  pdf_highlights: 'Edited',
  create_note: 'Created',
  create_folder: 'Created',
  capture_to_note: 'Created',
  attach_agent_log: 'Created',
  move_file: 'Moved',
  trash_file: 'Deleted',
  restore_version: 'Restored',
  browser_open: 'Opened',
  browser_navigate: 'Opened',
  browser_show: 'Opened',
  browser_click: 'Clicked',
  browser_hover: 'Clicked',
  browser_drag: 'Clicked',
  browser_type: 'Typed',
  browser_fill_form: 'Typed',
  browser_select: 'Typed',
  browser_press: 'Typed',
  browser_upload: 'Typed',
  browser_scroll: 'Scrolled',
  browser_wait: 'Waited',
  browser_close: 'Closed',
  browser_evaluate: 'Ran',
  browser_dialog: 'Clicked',
  run_command: 'Ran',
  run_terminal: 'Ran',
  write_setting: 'Changed',
  run_agent: 'Delegated',
  agent_result: 'Waited',
}

export function bareName(verb: string): string {
  return verb.replace(/^mcp__.+?__/, '')
}

export function verbOf(verb: string): string | null {
  return VERBS[bareName(verb)] ?? null
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function host(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

function noteName(path: string): string {
  return nameOf(path).replace(/\.(?:md|markdown|canvas|pdf)$/i, '')
}

export function objectOf(args: unknown): string {
  const said = record(args)
  for (const field of ['path', 'to', 'from', 'note', 'file']) {
    const value = said[field]
    if (typeof value === 'string' && value) return noteName(value)
  }
  if (typeof said.url === 'string' && said.url) return host(said.url)
  if (typeof said.query === 'string' && said.query) return `“${said.query.slice(0, 60)}”`
  for (const field of ['title', 'name', 'description', 'text', 'command']) {
    const value = said[field]
    if (typeof value === 'string' && value) return value.slice(0, 60)
  }
  return ''
}

export function helperOf(part: {
  verb: string
  result?: { text: string; agent?: string } | undefined
}): string | null {
  const name = bareName(part.verb)
  if (name !== 'run_agent' && name !== 'agent_result') return null
  if (part.result?.agent) return part.result.agent
  return /"agent"\s*:\s*"([\w-]+)"/.exec(part.result?.text ?? '')?.[1] ?? null
}
