import { message, t } from '../i18n.svelte'
import type { Account } from '../ai/accounts'
import type { LocalKind, ProviderKind } from '../ai/providers'
import { invoke, isDesktop, openExternal } from '../tauri'
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

async function accountOf(kind: ProviderKind): Promise<Account> {
  const { ai } = await import('../ai/store.svelte')
  const held = ai.accounts.find((one) => one.kind === kind)
  if (held) return held
  const made = ai.add(kind)
  await ai.written()
  return ai.accounts.find((one) => one.id === made.id) ?? made
}

async function withModel(account: Account): Promise<void> {
  const [{ listModels }, { firstModel }, { ai }] = await Promise.all([
    import('../ai/complete'),
    import('../ai/providers'),
    import('../ai/store.svelte'),
  ])
  const first = firstModel(account.kind, await listModels(account))
  const now = ai.accounts.find((one) => one.id === account.id)
  if (now && !now.model && first) ai.update(account.id, { model: first })
}

export async function signInWith(plan: Plan): Promise<Connecting> {
  const kind = signInKind(plan)
  if (!kind) return { state: 'failed', said: t('Could not sign in.') }
  const { plans } = await import('../ai/local/status.svelte')

  if (kind === 'chatgpt') {
    try {
      await invoke('chatgpt_sign_in')
      await plans.checkChatgpt()
      const account = await accountOf('chatgpt')
      void withModel(account).catch(() => undefined)
      return { state: 'in', id: account.id }
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error)
      return {
        state: 'failed',
        said:
          said === 'stopped' || said === 'timed out'
            ? t('Could not sign in.')
            : message(new Error(said), t('Could not sign in.')),
      }
    }
  }

  const local = kind as LocalKind
  const account = await accountOf(local)
  const standing = await plans.check({ id: account.id, kind: local })
  if (standing.state === 'in') return { state: 'in', id: account.id }
  if (standing.state === 'missing' || !standing.program) {
    void openExternal(INSTALL[local])
    return { state: 'failed', said: t('Not installed') }
  }
  const { signIn } = await import('../ai/local/signin')
  await signIn(local, standing.program, standing.home)
  plans.watch({ id: account.id, kind: local })
  return { state: 'waiting', id: account.id }
}

async function keyed(account: Account, typed: string): Promise<string | null> {
  const { writeKey } = await import('../ai/keys')
  try {
    await writeKey(account.id, typed.trim())
    await withModel(account)
    return null
  } catch (error) {
    return message(error, t('that key could not be saved'))
  }
}

export async function connectKey(
  kind: 'anthropic' | 'openai' | 'gemini',
  typed: string,
): Promise<string | null> {
  return keyed(await accountOf(kind), typed)
}

export async function connectCompatible(
  provider: Compatible,
  typed: string,
): Promise<string | null> {
  const { ai } = await import('../ai/store.svelte')
  const made = ai.add('compatible')
  ai.update(made.id, { name: provider.name, baseUrl: provider.baseUrl ?? '' })
  await ai.written()
  const account = ai.accounts.find((one) => one.id === made.id) ?? made
  if (provider.keyed) return keyed(account, typed)
  try {
    await withModel(account)
    return null
  } catch (error) {
    ai.remove(account.id)
    return message(error, t('Could not read the models.'))
  }
}
