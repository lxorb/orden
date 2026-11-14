import { isEffort } from '../chat/effort'
import type { Effort, Thread } from '../chat/types'
import { sign, doctor, status, usage } from './account'
import { availability } from './available'
import { catchup, reply } from './chats'
import { autocompact, copy, exportThread, listJobs, recap } from './conversation'
import { foundNow, fromOthers } from './found'
import { batch, fork, research, subtask } from './helpers'
import { type Host, hostOf, sendHere } from './host'
import { expand, type NoteCommand } from './notes'
import { goal, loop } from './running'
import { agents, init, memory, mention, outputStyle, skills } from './space'
import { ROWS, takenNames } from './table'
import { tasks } from './tasks.svelte'
import { planDay, showTasks } from './todos'
import type { CommandContext, Panel, PanelCommand } from './types'
import { explain, review, rewrite, summarize } from './words'
import { message } from '../../ui-kit/src/api'
import { FIRST_MODE, noMoreThan } from '../modes'

interface ReviewCommands {
  rewind(context: CommandContext): void | Promise<void>
  changes(context: CommandContext): void | Promise<void>
}
const REVIEW = import.meta.glob<ReviewCommands>('../review/commands.ts')
const loadReview = Object.values(REVIEW)[0]

async function reviewCommand(which: keyof ReviewCommands, context: CommandContext): Promise<void> {
  if (loadReview) await (await loadReview())[which](context)
}

function threadOf(context: CommandContext): Thread | null {
  return context.thread ?? context.panel.ensure?.() ?? null
}

async function report(host: Host, context: CommandContext, said: Promise<string>): Promise<void> {
  const thread = threadOf(context)
  const words = await said
  if (thread) host.line(thread, words)
}

export function effortIn(args: string): Effort | 'next' {
  const word = args.trim().toLowerCase()
  if (word === 'extra' || word === 'x-high') return 'xhigh'
  if (word === 'none') return 'off'
  return isEffort(word) ? word : 'next'
}

function onOff(args: string): boolean | undefined {
  const word = args.trim().toLowerCase()
  return word === 'on' ? true : word === 'off' ? false : undefined
}

async function settingsAt(section: 'ai' | 'agents' | 'shortcuts'): Promise<void> {
  const { settings } = await import('../../settings.svelte')
  settings.show(section)
}

type Run = (context: CommandContext, host: Host) => void | Promise<void>

const RUNS: Record<string, Run> = {
  new: async ({ args, panel }) => {
    panel.newThread()
    if (args) await panel.rename(args)
  },
  resume: ({ args, panel }) => panel.showThreads(args),
  rename: async ({ args, thread, panel }, host) => {
    if (args || !thread?.turns.length) await panel.rename(args || undefined)
    else await panel.rename((await recap(host, thread)) || undefined)
  },
  recap: async ({ thread, panel }, host) => {
    if (thread?.turns.length) await panel.rename((await recap(host, thread)) || undefined)
  },
  branch: ({ args, panel }) => panel.branch(args || undefined),
  fork: ({ args, thread }, host) => {
    if (thread) fork(host, thread, args)
  },
  rewind: (context) => reviewCommand('rewind', context),
  compact: ({ args, panel }) => panel.compact(args || undefined),
  autocompact: (context, host) => {
    const thread = threadOf(context)
    if (thread) autocompact(host, thread, context.args)
  },
  context: ({ panel }) => panel.openContext(),
  btw: async ({ args }) => {
    const { quick } = await import('../quick.svelte')
    quick.show()
    if (args && quick.open) {
      quick.question = args
      await quick.ask()
    }
  },
  copy: async ({ args, thread }) => {
    if (thread) await copy(thread, args)
  },
  export: async ({ args, thread, panel }, host) => {
    if (thread) await exportThread(host, thread, args)
    else await panel.exportThread()
  },
  archive: ({ panel }) => panel.archive(),
  delete: ({ panel }) => panel.remove(),
  stop: ({ thread, panel }) => {
    panel.stop()
    if (thread) tasks.stop(thread.id)
  },
  jobs: (context, host) => {
    const thread = threadOf(context)
    if (thread) listJobs(host, thread)
  },
  focus: ({ panel }) => panel.toggleFolded(),
  help: ({ panel }) => {
    if (panel.text === undefined) return settingsAt('shortcuts')
    panel.text = '/'
  },

  model: ({ args, panel }) => {
    if (!args || !panel.modelNamed(args)) panel.openModels()
  },
  effort: ({ args, panel }) => panel.setEffort(effortIn(args)),
  fast: ({ args, panel }) => panel.setFast(onOff(args)),
  'output-style': ({ args, thread }, host) => outputStyle(host, thread, args),

  approve: ({ args, panel }) => {
    panel.setMode('approve')
    if (args) panel.send(args)
  },
  plan: ({ args, panel }) => {
    panel.setMode('plan')
    if (args) panel.send(args)
  },
  auto: ({ args, panel }) => {
    panel.setMode('auto')
    if (args) panel.send(args)
  },
  full: ({ args, panel }) => {
    panel.setMode('full')
    if (args) panel.send(args)
  },
  agents: ({ args, thread }, host) => agents(host, thread, args),
  permissions: () => settingsAt('agents'),
  goal: (context, host) => {
    const thread = threadOf(context)
    if (thread) goal(host, thread, context.args)
  },
  loop: (context, host) => {
    const thread = threadOf(context)
    if (thread) loop(host, thread, context.args)
  },
  subtask: async (context, host) => {
    const thread = threadOf(context)
    if (thread && context.args) await subtask(host, thread, context.args)
  },
  bg: ({ args, panel }) => {
    if (args) panel.send(args)
    panel.newThread()
  },
  batch: async (context, host) => {
    const thread = threadOf(context)
    if (thread && context.args) await batch(host, thread, context.args)
  },
  'deep-research': async (context, host) => {
    const thread = threadOf(context)
    if (thread && context.args) await research(host, thread, context.args)
  },

  mention: ({ args }, host) => mention(host, args),
  'add-space': ({ args }, host) => mention(host, args),
  memory: ({ args, thread }, host) => memory(host, thread, args),
  init: ({ thread }, host) => init(host, thread),
  skills: ({ args, thread }, host) => skills(host, thread, args),
  mcp: () => settingsAt('agents'),

  shorter: () => void rewrite('shorter'),
  longer: () => void rewrite('longer'),
  fix: () => void rewrite('grammar'),
  translate: ({ args }) => void rewrite('translate', args),
  explain: ({ thread }, host) => explain(host, thread),
  summarize: ({ args, thread }, host) => summarize(host, thread, args),
  review: ({ args, thread }, host) => review(host, thread, args),
  diff: (context) => reviewCommand('changes', context),

  tasks: async (context, host) => {
    const thread = threadOf(context)
    if (thread) await showTasks(host, thread, context.args)
  },
  today: ({ args, thread }, host) => planDay(host, thread, args),
  catchup: async (context, host) => {
    const thread = threadOf(context)
    if (thread) await catchup(host, thread, context.args)
  },
  reply: async (context, host) => {
    const thread = threadOf(context)
    if (thread) await reply(host, thread, context.args)
  },
  status: (context, host) =>
    report(host, context, status(context.thread, host.panel.provider ?? null)),
  usage: (context, host) =>
    report(host, context, usage(context.thread, host.panel.provider ?? null)),
  login: (_context, host) => sign(host.panel.provider ?? null, false),
  logout: (_context, host) => sign(host.panel.provider ?? null, true),
  doctor: (context, host) => report(host, context, doctor(host.panel.provider ?? null)),
  config: () => settingsAt('ai'),
  keybindings: () => settingsAt('shortcuts'),
  theme: async () => (await import('../../theme-looks/src/api')).pickTheme(),
  vim: async () => {
    const { modes } = await import('../../modes.svelte')
    modes.setVimKeys(!modes.vim)
  },
  voice: ({ args, panel }) => panel.voice?.(onOff(args)),
}

async function guarded(host: Host, context: CommandContext, run: Run | undefined): Promise<void> {
  try {
    await run?.(context, host)
  } catch (error) {
    if (context.thread) host.line(context.thread, message(error, 'The model did not answer.'))
  }
}

function noteRow(note: NoteCommand, host: Host): PanelCommand {
  const onceIn = async (thread: Thread | null) => {
    const held = () => (thread ?? host.panel.ensure?.())?.mode ?? FIRST_MODE
    const theirs = note.mode ? await fromOthers(note.path) : false
    const mode = note.mode && theirs ? noMoreThan(note.mode, held()) : note.mode
    return {
      ...(note.model ? { model: note.model } : {}),
      ...(note.effort ? { effort: note.effort } : {}),
      ...(mode ? { mode } : {}),
    }
  }
  return {
    name: note.name,
    synonyms: [],
    ...(note.arguments.length ? { args: note.arguments.map((one) => `<${one}>`).join(' ') } : {}),
    ...(note.description ? { description: note.description } : {}),
    source: note.path,
    available: () => true,
    run: async ({ args, thread }) => {
      const once = await onceIn(thread)
      sendHere(host, thread, expand(note, args), Object.keys(once).length ? once : undefined)
    },
  }
}

export function commands(panel: Panel): readonly PanelCommand[] {
  const host = hostOf(panel)
  const ready = { review: !!loadReview }
  const builtIn = ROWS.map((row): PanelCommand => ({
    name: row.name,
    synonyms: [...row.synonyms],
    ...(row.args ? { args: row.args } : {}),
    description: row.description,
    source: 'orden',
    available: (kind) => availability(row.name, kind, ready),
    run: (context) => guarded(host, context, RUNS[row.name]),
  }))
  const taken = takenNames()
  const own = foundNow()
    .filter((one) => one.kind === 'command' && !taken.has(one.name))
    .map((one) => noteRow(one, host))
  return [...builtIn, ...own]
}
