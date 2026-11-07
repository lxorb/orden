<script lang="ts">
  import { vault } from './vault/start.svelte'
  import { slide } from 'svelte/transition'
  import { USAGE } from './chatgpt'
  import ChatGptMark from './ChatGptMark.svelte'
  import { plans } from './local/status.svelte'
  import { limitSentence } from './local/trouble'
  import type { Limit } from './local/heard'
  import type { LocalKind, Provider } from './providers'
  import { ai } from './store.svelte'
  import { message, t } from '../i18n.svelte'
  import { dur } from '../motion'
  import { invoke, openExternal } from '../tauri'

  interface Props {
    provider: Provider
    kind: LocalKind | 'chatgpt'
    refresh: (provider: Provider) => Promise<void>
    trouble: (said: string) => void
  }

  const { provider, kind, refresh, trouble }: Props = $props()

  let signingIn = $state(false)
  let signIns = 0

  const INSTALL: Record<LocalKind, string> = {
    'claude-code': 'https://code.claude.com/docs/en/setup',
    codex: 'https://developers.openai.com/codex/cli',
    'gemini-cli': 'https://geminicli.com/docs/get-started/installation/',
  }

  const USAGE_OF: Record<LocalKind | 'chatgpt', string> = {
    'claude-code': 'https://claude.ai/settings/usage',
    codex: USAGE,
    'gemini-cli': 'https://geminicli.com/docs/resources/quota-and-pricing/',
    chatgpt: USAGE,
  }

  const PLAN_OF: Record<LocalKind | 'chatgpt', string> = {
    'claude-code': 'Claude',
    codex: 'ChatGPT',
    'gemini-cli': 'Gemini',
    chatgpt: 'ChatGPT',
  }

  async function signInTo(kind: LocalKind) {
    const plan = plans.of(provider.id)
    if (!plan.program) return
    const [{ signIn }, { settings }] = await Promise.all([
      import('./local/signin'),
      import('../settings.svelte'),
    ])
    settings.open = false
    await signIn(kind, plan.program, plan.home)
    plans.watch({ id: provider.id, kind })
  }

  async function continueWithChatgpt() {
    const mine = ++signIns
    signingIn = true
    trouble('')
    try {
      await invoke('chatgpt_sign_in')
      await plans.checkChatgpt()
      await refresh(provider)
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error)
      if (said !== 'stopped') {
        trouble(
          said === 'timed out'
            ? t('Could not sign in.')
            : message(new Error(said), t('Could not sign in.')),
        )
      }
    } finally {
      if (signIns === mine) signingIn = false
    }
  }

  async function signOutOfChatgpt() {
    await invoke('chatgpt_sign_out').catch((error: unknown) => {
      trouble(message(error, t('Could not sign out.')))
    })
    plans.chatgptLimit = null
    await plans.checkChatgpt()
  }

  function limitWords(kind: LocalKind | 'chatgpt', limit: Limit | null): string {
    if (!limit || limit.state === 'fine') return ''
    if (limit.state === 'reached') return limitSentence(PLAN_OF[kind], limit)
    return t('Your {plan} plan is near its limit.', { plan: PLAN_OF[kind] })
  }
</script>

{#snippet program(kind: LocalKind)}
  {@const plan = plans.of(provider.id)}
  <div class="orden-setting setting">
    <span class="name">{t('Account')}</span>
    <div class="row">
      {#if plan.state === 'unknown' && !plan.program}
        <span class="hint">{t('Asking…')}</span>
      {:else if plan.state === 'missing'}
        <span class="hint">{t('Not installed')}</span>
        <button class="orden-chip" onclick={() => void openExternal(INSTALL[kind])}>
          {t('Install')}
        </button>
        <button
          class="orden-chip is-quiet"
          onclick={() => void plans.check({ id: provider.id, kind })}
        >
          {t('Check again')}
        </button>
      {:else if plan.state === 'in'}
        <span class="hint" title={plan.account ?? ''}>
          {plan.plan === 'API key'
            ? t('API key')
            : plan.plan
              ? t('{plan} plan', { plan: plan.plan })
              : t('Signed in')}
        </span>
      {:else if vault.seen[provider.id]}
        <span class="hint">{vault.seen[provider.id]}</span>
        <button class="orden-chip" disabled={!plan.program} onclick={() => void signInTo(kind)}>
          {t('Sign in here')}
        </button>
      {:else}
        <button class="orden-chip" disabled={!plan.program} onclick={() => void signInTo(kind)}>
          {t('Sign in')}
        </button>
      {/if}
    </div>
  </div>

  <label class="orden-setting setting">
    <span class="name">{t('Model')}</span>
    <input
      class="orden-field is-value"
      value={provider.model}
      placeholder={t('Default')}
      spellcheck="false"
      autocapitalize="off"
      autocorrect="off"
      autocomplete="off"
      onchange={(event) => ai.update(provider.id, { model: event.currentTarget.value.trim() })}
    />
  </label>

  {@render limited(kind, plan.limit)}
{/snippet}

{#snippet chatgpt()}
  <div class="orden-setting setting">
    <span class="name">{t('Account')}</span>
    <div class="row">
      {#if plans.chatgpt}
        <span class="hint">{plans.chatgpt.email ?? t('Signed in')}</span>
        <button class="orden-chip is-quiet" onclick={() => void signOutOfChatgpt()}>
          {t('Sign out')}
        </button>
      {:else if plans.chatgpt === null}
        {#if signingIn}<span class="hint">{t('Asking…')}</span>
        {:else if vault.seen[provider.id]}<span class="hint">{vault.seen[provider.id]}</span>{/if}
        <button class="orden-chip continue" onclick={() => void continueWithChatgpt()}>
          <ChatGptMark />
          {t('Continue with ChatGPT')}
        </button>
      {:else}
        <span class="hint">{t('Asking…')}</span>
      {/if}
    </div>
  </div>
  {@render limited('chatgpt', plans.chatgptLimit)}
{/snippet}

{#snippet limited(kind: LocalKind | 'chatgpt', limit: Limit | null)}
  {#if limitWords(kind, limit)}
    <div class="orden-setting setting" transition:slide={{ duration: dur(160) }}>
      <span class="name hint">{limitWords(kind, limit)}</span>
      <button class="orden-chip is-quiet" onclick={() => void openExternal(USAGE_OF[kind])}>
        {t('Manage usage')}
      </button>
    </div>
  {/if}
{/snippet}

{#if kind === 'chatgpt'}
  {@render chatgpt()}
{:else}
  {@render program(kind)}
{/if}

<style>
  .setting .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .setting .name.hint {
    white-space: normal;
  }

  .row {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .continue {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  :global(.sheet.phone) .setting {
    position: relative;
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }
</style>
