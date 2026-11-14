import {
  appendNote,
  deleteFile,
  moveFile,
  newNote,
  openNote,
  publishNow,
  runCommand,
  searchSpace,
  setProperty,
  syncNow,
  writeFile,
} from './acts'
import {
  countWords,
  listBacklinks,
  listBookmarks,
  listCommands,
  listFiles,
  listLinks,
  listOrphans,
  listTags,
  publishStatus,
  readFile,
  readNoteProperties,
  readOutline,
  syncStatus,
  windowRect,
} from './answers'
import type { Scope } from '../agents/src/api'
import { said as wordsOf, type Road, type Said, yes } from './args'
import { type AgentAnswer, type Caller, holds, READER, refusal } from './caller'

interface Verb {
  takes?: readonly string[]
  byLink?: 'quiet' | 'back'
  confirms?: boolean
  run?: (args: Said, road: Road) => unknown
  agent?: Scope | null
}

function needs(scope: Scope | null): Verb {
  return { agent: scope }
}

const VERBS: Record<string, Verb> = {
  open: { takes: ['path'], byLink: 'quiet', run: openNote },
  new: { takes: ['name'], byLink: 'back', run: newNote },
  append: { takes: ['path', 'content'], byLink: 'back', run: appendNote },
  search: { takes: ['query'], byLink: 'quiet', run: searchSpace },
  'commands.run': { takes: ['id'], byLink: 'quiet', run: runCommand },

  'tasks.list': { takes: ['filter'], run: (args) => asReader('list_tasks', args) },
  'tasks.add': { takes: ['text'], byLink: 'back', run: addTask },
  'tasks.done': {
    takes: ['at'],
    run: (args) => asReader('update_task', { ...args, done: !yes(args, 'undo') }),
  },
  'base.query': { takes: ['path'], run: (args) => asReader('query_base', args) },

  'files.list': { run: listFiles },
  'files.read': { takes: ['path'], run: readFile },
  'commands.list': { run: listCommands },
  links: { takes: ['path'], run: listLinks },
  backlinks: { takes: ['path'], run: listBacklinks },
  orphans: { run: listOrphans },
  tags: { run: listTags },
  'properties.read': { takes: ['path'], run: readNoteProperties },
  outline: { takes: ['path'], run: readOutline },
  bookmarks: { run: listBookmarks, agent: 'workspace' },
  words: { takes: ['path'], run: countWords },
  'sync.status': { run: syncStatus },
  'publish.status': { run: publishStatus },
  window: { run: windowRect },

  'sync.now': { run: syncNow },
  'publish.now': { run: publishNow },

  verbs: { run: () => ({ verbs: verbNames() }) },

  'files.write': { takes: ['path', 'content'], confirms: true, run: writeFile },
  'files.move': { takes: ['path', 'to'], confirms: true, run: moveFile },
  'files.delete': { takes: ['path'], confirms: true, run: deleteFile },
  'properties.set': { takes: ['key', 'value'], confirms: true, run: setProperty },

  eval: { takes: ['code'], confirms: true, run: runEval },

  get_context: needs('context'),
  list_spaces: needs(null),
  list_notes: needs('notes.read'),
  search_notes: needs('notes.read'),
  list_backlinks: needs('notes.read'),
  read_note: needs('notes.read'),
  list_versions: needs('notes.read'),
  read_canvas: needs('notes.read'),
  read_pdf: needs('notes.read'),
  pdf_highlights: needs('notes.read'),
  edit_note: needs('notes.write'),
  write_note: needs('notes.write'),
  append_note: needs('notes.write'),
  set_property: needs('notes.write'),
  set_task: needs('notes.write'),
  list_tasks: needs('notes.read'),
  add_task: needs('notes.write'),
  update_task: needs('notes.write'),
  query_base: needs('notes.read'),
  add_row: needs('notes.write'),
  edit_rows: needs('notes.write'),
  edit_base: needs('notes.write'),
  create_note: needs('notes.write'),
  restore_version: needs('notes.write'),
  edit_canvas: needs('notes.write'),
  capture_to_note: needs('notes.write'),
  attach_agent_log: needs('notes.write'),
  move_file: needs('tree'),
  trash_file: needs('tree'),
  create_folder: needs('tree'),
  workspace_tabs: needs('workspace'),
  run_command: needs('workspace'),
  read_setting: needs(null),
  write_setting: needs('settings'),
  run_terminal: needs('terminal'),
  read_terminal: needs('context'),
  type_terminal: needs('terminal'),
  system_clipboard: needs('clipboard'),
  ask_reader: needs('ask'),
  note_editor: needs('editor'),
  application_tabs: needs('applications'),
  explorer_tabs: needs('files'),
  recently_deleted: needs('tree'),
  list_chats: needs('chats.read'),
  read_chat: needs('chats.read'),
  search_chats: needs('chats.read'),
  draft_message: needs('chats.write'),
  post_message: needs('chats.write'),
  react: needs('chats.write'),
  run_agent: needs('agents'),
  agent_result: needs('agents'),

  'agent.reader_tabs': { run: (args) => fromTheCrate('agent.reader_tabs', args) },
  'agent.lend': { run: (args) => fromTheCrate('agent.lend', args) },
  'agent.store_for': { run: (args) => fromTheCrate('agent.store_for', args) },
  'agent.markdown': { run: (args) => fromTheCrate('agent.markdown', args) },
  'agent.working_folder': { run: (args) => fromTheCrate('agent.working_folder', args) },
}

const BY_LINK: Record<string, string> = { command: 'commands.run', 'add-task': 'tasks.add' }

export function verbForAction(action: string): string | null {
  if (Object.values(BY_LINK).includes(action)) return null

  const name = BY_LINK[action] ?? action
  return VERBS[name]?.byLink === undefined ? null : name
}

export function linkHearsFrom(verb: string): boolean {
  return VERBS[verb]?.byLink === 'back'
}

export function isVerb(action: string): boolean {
  return (BY_LINK[action] ?? action) in VERBS
}

function verbNames(): string[] {
  return Object.keys(VERBS).sort()
}

export type Plain = { ok: true; value: unknown } | { ok: false; error: string }

export type Answered = Plain | AgentAnswer

export async function dispatch(
  verb: string,
  args: Said,
  rest?: readonly string[],
  road?: Road,
): Promise<Plain>
export async function dispatch(
  verb: string,
  args: Said,
  rest: readonly string[],
  road: Road,
  caller: Caller,
): Promise<Answered>
export async function dispatch(
  verb: string,
  args: Said,
  rest: readonly string[] = [],
  road: Road = 'here',
  caller: Caller = READER,
): Promise<Answered> {
  const [name, words] = twoWords(verb, rest)

  const found = VERBS[name]
  if (!found) return { ok: false, error: `there is no verb called ${name}` }

  const run = found.run
  if (found.agent !== undefined && (caller.agent !== null || run === undefined)) {
    return agentVerb(name, found.agent, args, caller)
  }
  if (caller.agent !== null || run === undefined) {
    return refusal('not_granted', `${name} is not a verb an agent may call`)
  }

  const said = { ...withPositions(found, words), ...args }

  if (found.confirms === true && !yes(said, 'yes')) {
    return { ok: false, error: `${name} changes something: say yes to go ahead` }
  }

  try {
    return { ok: true, value: await run(said, road) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function agentVerb(
  name: string,
  scope: Scope | null,
  args: Said,
  caller: Caller,
): Promise<Answered> {
  if (scope !== null && !holds(caller, scope)) {
    return refusal('not_granted', `${name} needs ${scope}, which this agent was not granted`)
  }

  const { runAgentVerb } = await import('../agent-host/index')
  const answer = await runAgentVerb(name, args, caller)
  if (caller.agent !== null) return answer

  if (answer.status === 'ok') return { ok: true, value: answer.result }
  return { ok: false, error: answer.status === 'error' ? answer.message : answer.summary }
}

async function asReader(name: string, args: Said): Promise<unknown> {
  const { runAgentVerb } = await import('../agent-host/index')
  const answer = await runAgentVerb(name, args, READER)
  if (answer.status === 'ok') return answer.result
  throw new Error(answer.status === 'error' ? answer.message : answer.summary)
}

function addTask(args: Said, road: Road): Promise<unknown> {
  if (road !== 'link') return asReader('add_task', args)
  const space = wordsOf(args, 'space')
  return asReader('add_task', { text: args.text, ...(space === null ? {} : { space }) })
}

async function fromTheCrate(name: string, args: Said): Promise<unknown> {
  const { answerTheCrate } = await import('../agent-host/index')
  return answerTheCrate(name, args)
}

function twoWords(verb: string, rest: readonly string[]): [string, readonly string[]] {
  const [next, ...after] = rest
  if (verb in VERBS || next === undefined) return [verb, rest]

  return `${verb}.${next}` in VERBS ? [`${verb}.${next}`, after] : [verb, rest]
}

function withPositions(verb: Verb, rest: readonly string[]): Said {
  const out: Said = {}
  for (const [at, name] of (verb.takes ?? []).entries()) {
    const value = rest[at]
    if (value !== undefined) out[name] = value
  }

  return out
}

async function runEval(args: Said): Promise<unknown> {
  if (__EVEN_PLUGIN__) throw new Error('the plugin does not run code')

  const code = wordsOf(args, 'code')
  if (!code) throw new Error('say what to run')

  const { evaluate } = await import('./eval')
  return evaluate(code)
}
