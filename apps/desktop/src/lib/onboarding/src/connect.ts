import { message } from '../../ui-kit/src/api'
import type { Account } from '../../ai-providers/src/api'
import type { LocalKind, ProviderKind } from '../../ai-providers/src/api'
import { invoke, isDesktop, openExternal } from '../../platform/src/api'
import type { Compatible, Plan } from './catalog'

export type Connecting =
  { state: 'in'; id: string } | { state: 'waiting'; id: string } | { state: 'failed'; said: string }

const LOCAL: Partial<Record<Plan, LocalKind>> = {
  claude: 'claude-code',
  gemini: 'gemini-cli',
}

const INSTALL: Record<LocalKind, string> = {
  'claude-code': 'https://code.claude.com/docs/en/setup',
  codex: 'https://developers.openai.com/codex/cli',
  'gemini-cli': 'https://geminicli.com/docs/get-started/installation/',
}

export function signInKind(plan: Plan): ProviderKind | null {
  if (!isDesktop) return null
  if (plan === 'chatgpt') return 'chatgpt'
  if (plan === 'claude' && !__CLAUDE_CODE__) return null
  return LOCAL[plan] ?? null
}

async function accountOf(kind: ProviderKind): Promise<{ account: Account; made: boolean }> {
  const { ai } = await import('../../ai-providers/src/api')
  const held = ai.accounts.find((one) => one.kind === kind)
  if (held) return { account: held, made: false }
  const made = ai.add(kind)
  await ai.written()
  return { account: ai.accounts.find((one) => one.id === made.id) ?? made, made: true }
}

async function withModel(account: Account): Promise<void> {
  const { listModels, firstModel, ai } = await import('../../ai-providers/src/api')
  const first = firstModel(account.kind, await listModels(account))
  const now = ai.accounts.find((one) => one.id === account.id)
  if (now && !now.model && first) ai.update(account.id, { model: first })
}

export async function signInWith(plan: Plan): Promise<Connecting> {
  const kind = signInKind(plan)
  if (!kind) return { state: 'failed', said: 'Could not sign in.' }
  const { plans } = await (await import('../../ai-providers/src/api')).localCli()

  if (kind === 'chatgpt') {
    try {
      await invoke('chatgpt_sign_in')
      await plans.checkChatgpt()
      const { account } = await accountOf('chatgpt')
      void withModel(account).catch(() => undefined)
      return { state: 'in', id: account.id }
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error)
      return {
        state: 'failed',
        said:
          said === 'stopped' || said === 'timed out'
            ? 'Could not sign in.'
            : message(new Error(said), 'Could not sign in.'),
      }
    }
  }

  const local = kind as LocalKind
  const { account, made } = await accountOf(local)
  const standing = await plans.check({ id: account.id, kind: local })
  if (standing.state === 'in') return { state: 'in', id: account.id }
  const takeBack = async () => {
    if (made) (await import('../../ai-providers/src/api')).ai.remove(account.id)
  }
  if (standing.state === 'missing' || !standing.program) {
    await takeBack()
    void openExternal(INSTALL[local])
    return { state: 'failed', said: 'Not installed' }
  }
  const { signIn } = await (await import('../../ai-providers/src/api')).localCli()
  if (!(await signIn(local, standing.program, standing.home).catch(() => false))) {
    await takeBack()
    return { state: 'failed', said: 'Could not sign in.' }
  }
  plans.watch({ id: account.id, kind: local })
  return { state: 'waiting', id: account.id }
}

async function keyed(account: Account, typed: string, made: boolean): Promise<string | null> {
  const { ai, forgetKey, writeKey } = await import('../../ai-providers/src/api')
  try {
    await writeKey(account.id, typed.trim())
    await withModel(account)
    return null
  } catch (error) {
    if (made) {
      await forgetKey(account.id, true).catch(() => undefined)
      ai.remove(account.id)
    }
    return message(error, 'That key could not be saved.')
  }
}

export async function connectKey(
  kind: 'anthropic' | 'openai' | 'gemini',
  typed: string,
): Promise<string | null> {
  const { account, made } = await accountOf(kind)
  return keyed(account, typed, made)
}

export async function connectCompatible(
  provider: Compatible,
  typed: string,
): Promise<string | null> {
  const { ai } = await import('../../ai-providers/src/api')
  const made = ai.add('compatible')
  ai.update(made.id, { name: provider.name, baseUrl: provider.baseUrl ?? '' })
  await ai.written()
  const account = ai.accounts.find((one) => one.id === made.id) ?? made
  if (provider.keyed) return keyed(account, typed, true)
  try {
    await withModel(account)
    return null
  } catch (error) {
    ai.remove(account.id)
    return message(error, 'Could not read the models.')
  }
}
