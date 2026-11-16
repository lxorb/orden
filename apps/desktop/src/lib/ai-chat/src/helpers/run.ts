import { workspace } from '../../../workspace/src/api'
import { invoke, isDesktop } from '../../../platform/src/api'
import type { Effort, Mode, Thread } from '../../../ai-providers/src/api'
import { usable, ai } from '../../../ai-providers/src/api'
import { answerFor, type Helper, helpers } from './helpers.svelte'
import type { Offered } from './route'

export const HELPER_TOOLS: ReadonlySet<string> = new Set(['run_agent', 'agent_result'])

export const WAIT = 20_000

const LISTING = 10_000

export interface Reach {
  scopes: readonly string[]
  spaces: 'all' | readonly string[]
  sites: Readonly<Record<string, string>>
  programs: readonly string[]
}

export interface Asker {
  thread: string | null
  mode: Mode
  reach?: Reach
}

export interface Held extends Reach {
  id: string
}

async function grants(): Promise<Held[] | null> {
  if (!isDesktop) return []
  const state = await invoke<{ agents?: unknown }>('agents_state').catch(() => null)
  return Array.isArray(state?.agents) ? (state.agents as Held[]) : null
}

const grantOf = (all: readonly Held[], provider: string) =>
  all.find((one) => one.id === `orden-${provider}`) ??
  all.find((one) => one.id === `nib-${provider}`) ??
  null

function inside(helper: Reach, parent: Reach): boolean {
  const spaces =
    parent.spaces === 'all' ||
    (helper.spaces !== 'all' && helper.spaces.every((one) => parent.spaces.includes(one)))
  return (
    spaces &&
    helper.scopes.every((one) => parent.scopes.includes(one)) &&
    helper.programs.every((one) => parent.programs.includes(one)) &&
    Object.entries(helper.sites).every(
      ([site, rule]) => rule !== 'allow' || parent.sites[site] === 'allow',
    )
  )
}

export function offeredWithin(
  listed: readonly Offered[],
  reach: Reach | null,
  parent: string | null,
  all: readonly Held[] | null,
): Offered[] {
  if (!reach) return [...listed]
  return listed.filter(({ provider }) => {
    if (provider.id === parent) return true
    const theirs = all === null ? null : grantOf(all, provider.id)
    return theirs !== null && inside(theirs, reach)
  })
}

export type Answered =
  | {
      agent: string
      state: Helper['state']
      provider: string
      model: string
      answer?: string
      error?: string
    }
  | { refused: string }

function said(helper: Helper): Answered {
  return {
    agent: helper.id,
    state: helper.state,
    provider: helper.provider,
    model: helper.model,
    ...(helper.state === 'running' ? {} : { answer: answerFor(helper) }),
    ...(helper.error ? { error: helper.error } : {}),
  }
}

const first = (...words: (string | undefined)[]): string => words.find(Boolean) ?? ''

function word(args: Record<string, unknown>, name: string): string {
  const value = args[name]
  return typeof value === 'string' ? value.trim() : ''
}

const EFFORTS: readonly Effort[] = [
  'auto',
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

async function offered(): Promise<Offered[]> {
  const { chat } = await import('../store/chat.svelte')
  const usableOnes = ai.providers.filter(usable)
  return await Promise.all(
    usableOnes.map(async (provider) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<[]>((done) => (timer = setTimeout(() => done([]), LISTING)))
      const models = await Promise.race([chat.loadModels(provider), late])
      clearTimeout(timer)
      return { provider, models }
    }),
  )
}

export async function runAgent(args: Record<string, unknown>, asker: Asker): Promise<Answered> {
  const prompt = word(args, 'prompt')
  if (!prompt) return { refused: 'say prompt: the whole task, as the helper should read it' }
  const { chat } = await import('../store/chat.svelte')
  const parent = asker.thread ? chat.threadOf(asker.thread) : null
  const space = parent?.space ?? workspace.activeSpace?.id ?? ''
  if (!space) return { refused: 'open a space first' }

  const type = word(args, 'subagent_type')
  const notes = await import('../commands/found')
  const root = notes.rootOfSpace(space)
  const profile = type && root ? await notes.foundNamed('agent', type, root) : null
  if (type && !profile) return { refused: `there is no agent profile called "${type}"` }
  const instructions = await notes.wordsOf(profile)
  const all = await grants()
  const reach = asker.reach ?? (parent && all ? grantOf(all, parent.provider) : null)
  if (parent && !asker.reach && isDesktop && !reach?.scopes.includes('agents')) {
    return { refused: 'this agent may not run helpers: its grant does not hold agents' }
  }
  const effort = first(word(args, 'effort'), profile?.effort)
  const started = await helpers.start(
    {
      parent,
      space,
      prompt,
      description: word(args, 'description'),
      model: first(word(args, 'model'), profile?.model),
      ...(EFFORTS.includes(effort as Effort) ? { effort: effort as Effort } : {}),
      mode: parent?.mode ?? asker.mode,
      ...(instructions ? { instructions } : {}),
    },
    {
      offered: async () => offeredWithin(await offered(), reach, parent?.provider ?? null, all),
      run: (thread: Thread, text: string, signal: AbortSignal) => {
        chat.adopt(thread)
        return chat.turn(thread, text, { signal })
      },
    },
  )
  if ('refused' in started) return started
  const now = await helpers.wait(started.id, WAIT)
  return said(now ?? started)
}

export async function agentResult(args: Record<string, unknown>): Promise<Answered> {
  const id = word(args, 'agent')
  const now = id ? await helpers.wait(id, WAIT) : null
  return now ? said(now) : { refused: `there is no helper called "${id}"` }
}

export async function helperHere(
  name: string,
  args: Record<string, unknown>,
  asker: Asker,
): Promise<Answered> {
  let answered = name === 'run_agent' ? await runAgent(args, asker) : await agentResult(args)
  while (!('refused' in answered) && answered.state === 'running') {
    answered = await agentResult({ agent: answered.agent })
  }
  return answered
}

export function answerText(answered: Answered): string {
  if ('refused' in answered) return answered.refused
  const who = `helper ${answered.agent} (${answered.model || answered.provider})`
  switch (answered.state) {
    case 'running':
      return `${who} is still working. Call agent_result with agent "${answered.agent}" to wait for its answer.`
    case 'done':
      return first(answered.answer, `${who} finished without a word.`)
    case 'stopped':
      return `${who} was stopped${answered.answer ? `. What it said so far:\n\n${answered.answer}` : '.'}`
    case 'failed':
      return `${who} failed: ${answered.error ?? 'it did not answer'}`
  }
}
