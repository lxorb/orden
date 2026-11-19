import { nameOf } from '../../platform/src/api'

const VERBS: Record<string, string> = Object.fromEntries(
  Object.entries({
    Read: 'read_note read_canvas read_pdf browser_read browser_snapshot browser_find browser_screenshot browser_console browser_network browser_downloads',
    Searched: 'search_notes',
    Listed: 'list_notes list_spaces list_backlinks list_versions browser_tabs workspace_tabs bookmarks',
    Checked: 'get_context agent_status approval_status read_setting',
    Edited: 'edit_note write_note append_note set_property set_task edit_canvas pdf_highlights',
    Created: 'create_note create_folder capture_to_note attach_agent_log',
    Moved: 'move_file',
    Deleted: 'trash_file',
    Restored: 'restore_version',
    Opened: 'browser_open browser_navigate browser_show',
    Clicked: 'browser_click browser_hover browser_drag browser_dialog',
    Typed: 'browser_type browser_fill_form browser_select browser_press browser_upload',
    Scrolled: 'browser_scroll',
    Waited: 'browser_wait agent_result',
    Closed: 'browser_close',
    Ran: 'browser_evaluate run_command run_terminal',
    Changed: 'write_setting',
    Delegated: 'run_agent',
  }).flatMap(([verb, names]) => names.split(' ').map((name) => [name, verb])),
)

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

export function helperOf(part: { verb: string; result?: { text: string; agent?: string } | undefined }): string | null {
  const name = bareName(part.verb)
  if (name !== 'run_agent' && name !== 'agent_result') return null
  if (part.result?.agent) return part.result.agent
  return /"agent"\s*:\s*"([\w-]+)"/.exec(part.result?.text ?? '')?.[1] ?? null
}
