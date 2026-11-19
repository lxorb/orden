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
import { type AgentScope as Scope, portOf, runAgentVerb } from '@orden/contracts'
import { said as wordsOf, type Road, type Said, yes } from './args'
import { type AgentAnswer, type Caller, holds, READER, refusal } from './caller'

interface Verb {
  takes?: readonly string[]
  oneWordEach?: boolean
  byLink?: 'quiet' | 'back'
  confirms?: boolean
  run?: (args: Said, road: Road) => unknown
  agent?: Scope | null
}
const SCOPED: [Scope | null, string][] = [
  [null, 'list_spaces read_setting'],
  ['context', 'get_context read_terminal'],
  ['notes.read', 'list_notes search_notes list_backlinks read_note list_versions read_canvas'],
  ['notes.read', 'read_pdf pdf_highlights list_tasks query_base'],
  ['notes.write', 'edit_note write_note append_note set_property set_task add_task update_task'],
  ['notes.write', 'add_row edit_rows edit_base create_note restore_version edit_canvas'],
  ['notes.write', 'capture_to_note attach_agent_log'],
  ['tree', 'move_file trash_file create_folder recently_deleted'],
  ['workspace', 'workspace_tabs run_command'],
  ['settings', 'write_setting'],
  ['terminal', 'run_terminal type_terminal'],
  ['clipboard', 'system_clipboard'],
  ['ask', 'ask_reader'],
  ['editor', 'note_editor'],
  ['applications', 'application_tabs'],
  ['files', 'explorer_tabs'],
  ['chats.read', 'list_chats read_chat search_chats'],
  ['chats.write', 'draft_message post_message react'],
  ['agents', 'run_agent agent_result'],
]
const VERBS: Record<string, Verb> = {
  open: { takes: ['path'], byLink: 'quiet', run: openNote },
  new: { takes: ['name'], byLink: 'back', run: newNote },
  append: { takes: ['path', 'content'], byLink: 'back', run: appendNote },
  search: { takes: ['query'], byLink: 'quiet', run: searchSpace },
  'commands.run': { takes: ['id'], byLink: 'quiet', run: runCommand },
  'tasks.list': {
    takes: ['filter'],
    run: (args) => asReader('list_tasks', unheard(spaceless(args), 'tasks.list', ['filter', 'view'])),
  },
  'tasks.add': { takes: ['text'], byLink: 'back', run: addTask },
  'tasks.done': {
    takes: ['at'],
    run: (args) => asReader('update_task', { ...spaceless(args), done: !yes(args, 'undo') }),
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
  'files.move': { takes: ['path', 'to'], oneWordEach: true, confirms: true, run: moveFile },
  'files.delete': { takes: ['path'], confirms: true, run: deleteFile },
  'properties.set': { takes: ['key', 'value'], confirms: true, run: setProperty },
  eval: { takes: ['code'], confirms: true, run: runEval },
  ...Object.fromEntries(SCOPED.flatMap(([scope, names]) => names.split(' ').map((name) => [name, { agent: scope }]))),
  'agent.reader_tabs': { run: (args) => fromTheCrate('agent.reader_tabs', args) },
  'agent.lend': { run: (args) => fromTheCrate('agent.lend', args) },
  'agent.store_for': { run: (args) => fromTheCrate('agent.store_for', args) },
  'agent.markdown': { run: (args) => fromTheCrate('agent.markdown', args) },
  'agent.may_hand': { run: (args) => fromTheCrate('agent.may_hand', args) },
  'agent.program_free': { run: (args) => fromTheCrate('agent.program_free', args) },
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
export async function dispatch(verb: string, args: Said, rest?: readonly string[], road?: Road): Promise<Plain>
export async function dispatch(
  verb: string,
  args: Said,
  rest: readonly string[],
  road: Road,
  caller: Caller,
  deadline?: AbortSignal,
): Promise<Answered>
export async function dispatch(
  verb: string,
  args: Said,
  rest: readonly string[] = [],
  road: Road = 'here',
  caller: Caller = READER,
  deadline?: AbortSignal,
): Promise<Answered> {
  const [name, words] = twoWords(verb, rest)
  const found = VERBS[name]
  if (!found) return { ok: false, error: `there is no verb called ${name}` }
  const run = found.run
  if (found.agent !== undefined && (caller.agent !== null || run === undefined)) {
    return agentVerb(name, found.agent, args, caller, deadline)
  }
  if (caller.agent !== null || run === undefined) {
    return refusal('not_granted', `${name} is not a verb an agent may call`)
  }
  const takes = found.takes ?? []
  if (found.oneWordEach === true && words.length > takes.length) {
    return {
      ok: false,
      error: `${name} takes ${takes.join(' and ')}, one word each: quote a path with spaces in it`,
    }
  }
  const said = { ...withPositions(takes, words), ...args }
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
  deadline: AbortSignal | undefined,
): Promise<Answered> {
  if (scope !== null && !holds(caller, scope)) {
    return refusal('not_granted', `${name} needs ${scope}, which this agent was not granted`)
  }
  const answer = await runAgentVerb(name, args, caller, deadline)
  if (caller.agent !== null) return answer
  if (answer.status === 'ok') return { ok: true, value: answer.result }
  return { ok: false, error: answer.status === 'error' ? answer.message : answer.summary }
}
async function asReader(name: string, args: Said): Promise<unknown> {
  const answer = await runAgentVerb(name, args, READER)
  if (answer.status === 'ok') return answer.result
  throw new Error(answer.status === 'error' ? answer.message : answer.summary)
}
function unheard(args: Said, verb: string, names: readonly string[]): Said {
  const found = names.find((name) => name in args)
  if (found !== undefined) throw new Error(`${verb} takes no ${found}`)
  return args
}
function addTask(args: Said, road: Road): Promise<unknown> {
  if (road !== 'link') return asReader('add_task', unheard(spaceless(args), 'tasks.add', ['note', 'under']))
  return asReader('add_task', { text: args.text })
}
function spaceless(args: Said): Said {
  return Object.fromEntries(Object.entries(args).filter(([name]) => name !== 'space'))
}
async function fromTheCrate(name: string, args: Said): Promise<unknown> {
  const crate = portOf('agents.crate')
  if (!crate.ok) throw new Error(`there is no verb called ${name}`)
  return crate.value.answer(name, args)
}
function twoWords(verb: string, rest: readonly string[]): [string, readonly string[]] {
  const [next, ...after] = rest
  if (verb in VERBS || next === undefined) return [verb, rest]
  return `${verb}.${next}` in VERBS ? [`${verb}.${next}`, after] : [verb, rest]
}
function withPositions(takes: readonly string[], rest: readonly string[]): Said {
  const out: Said = {}
  for (const [at, name] of takes.entries()) {
    if (at >= rest.length) break
    out[name] = at === takes.length - 1 ? rest.slice(at).join(' ') : rest[at]
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
