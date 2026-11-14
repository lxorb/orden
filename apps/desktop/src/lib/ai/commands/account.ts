import { localDate, invoke } from '../../platform/src/api'
import { isLocal, KIND_NAMES, type Provider } from '../../ai-providers/src/api'
import type { Thread } from '../../ai-providers/src/api'
import { filled } from '../chat/usage'
import { engineFor } from '../chat/engine'

function rows(pairs: readonly (readonly [string, string | number | null | undefined])[]): string {
  return pairs
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([word, value]) => `${word}: ${value}`)
    .join('\n')
}

export function tokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`
  return String(count)
}

async function plansOf() {
  return (await (await import('../../ai-providers/src/api')).localCli()).plans
}

export async function status(thread: Thread | null, provider: Provider | null): Promise<string> {
  if (!provider) return 'Add an AI provider in Settings first.'
  let plan: string | null = null
  let account: string | null = null
  if (isLocal(provider.kind)) {
    const now = await (await plansOf()).check({ id: provider.id, kind: provider.kind })
    plan = now.plan
    account = now.account ?? (now.state === 'out' ? 'Signed out' : null)
  } else if (provider.kind === 'chatgpt') {
    const plans = await plansOf()
    await plans.checkChatgpt()
    account = plans.chatgpt?.email ?? 'Signed out'
  }
  return rows([
    [
      'Provider',
      `${KIND_NAMES[provider.kind]}${provider.name !== KIND_NAMES[provider.kind] ? `, ${provider.name}` : ''}`,
    ],
    ['Model', [thread?.model ?? provider.model, thread?.effort].filter(Boolean).join(', ')],
    ['Mode', thread?.mode],
    ['Account', [plan, account].filter(Boolean).join(', ')],
    ['Agents', `Orden ${provider.name}`],
    ['Version', __APP_VERSION__],
  ])
}

export async function usage(thread: Thread | null, provider: Provider | null): Promise<string> {
  const spent = thread?.spent
  const window = thread?.usage.window ?? null
  let limit = null
  if (provider && isLocal(provider.kind)) limit = (await plansOf()).of(provider.id).limit
  else if (provider?.kind === 'chatgpt') limit = (await plansOf()).chatgptLimit
  const until = limit?.until
    ? localDate(limit.until, { dateStyle: 'medium', timeStyle: 'short' })
    : limit?.untilWords
  const standing =
    limit && limit.state !== 'fine'
      ? [limit.state === 'reached' ? 'At its limit' : 'Near its limit', until]
      : []
  return (
    rows([
      ['This thread', spent ? `↑ ${tokens(spent.input)} ↓ ${tokens(spent.output)}` : null],
      ['Window', thread && window ? `${tokens(filled(thread.usage))} / ${tokens(window)}` : null],
      ['Cost', spent?.cost !== undefined ? `$${spent.cost.toFixed(4)}` : null],
      ['Account', standing.filter(Boolean).join(', ')],
    ]) || '∅'
  )
}

export async function doctor(provider: Provider | null): Promise<string> {
  if (!provider) return 'Add an AI provider in Settings first.'
  const out: [string, string | null][] = [['Provider', KIND_NAMES[provider.kind]]]
  if (isLocal(provider.kind)) {
    const now = await (await plansOf()).check({ id: provider.id, kind: provider.kind })
    out.push(['Program', now.program ?? 'Not installed'])
    out.push(['Signed in', now.state === 'in' ? '✓' : now.state === 'out' ? '✕' : '?'])
  } else if (provider.baseUrl) {
    out.push(['Address', provider.baseUrl])
  }
  const listed = await engineFor(provider.kind, { provider: () => provider })
    .then((engine) => engine.models(provider))
    .then(
      (models) => `✓ ${models.length}`,
      (error: unknown) => `✕ ${error instanceof Error ? error.message : String(error)}`,
    )
  out.push(['Models', listed])
  return rows(out)
}

export async function sign(provider: Provider | null, out: boolean): Promise<void> {
  const { settings } = await import('../../settings.svelte')
  if (!provider || (!isLocal(provider.kind) && provider.kind !== 'chatgpt')) {
    settings.show('ai')
    return
  }
  const plans = await plansOf()
  if (provider.kind === 'chatgpt') {
    await invoke(out ? 'chatgpt_sign_out' : 'chatgpt_sign_in').catch(() => undefined)
    await plans.checkChatgpt()
    return
  }
  const account = { id: provider.id, kind: provider.kind }
  const known = plans.of(account.id)
  const plan = known.program ? known : await plans.check(account)
  if (!plan.program) {
    settings.show('ai')
    return
  }
  const { signIn, signOut } = await (await import('../../ai-providers/src/api')).localCli()
  await (out ? signOut : signIn)(account.kind, plan.program, plan.home)
  plans.watch(account)
}
