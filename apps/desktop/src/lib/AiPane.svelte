<script lang="ts">
  import { onMount } from 'svelte'
  import { accountName, vendorName } from './ai/account-words'
  import { type Account, repeatable } from './ai/accounts'
  import { FEATURES, ai } from './ai/store.svelte'
  import { listModels } from './ai/complete'
  import { forgetKey, hasKey, keysAreGuarded, keysInFile, keysMoved, writeKey } from './ai/keys'
  import { plans } from './ai/local/status.svelte'
  import { browserVault, keepBrowserInVault, vault } from './ai/vault/start.svelte'
  import PlanRows from './ai/PlanRows.svelte'
  import ProviderMark from './ai/ProviderMark.svelte'
  import {
    firstModel,
    isLocal,
    KIND_NAMES,
    offeredKinds,
    type Provider,
    type ProviderKind,
    reachable,
  } from './ai/providers'
  import { glassesKey } from './even/key.svelte'
  import { NoWord, wordSaid } from './mobile/bridge'
  import { message, t } from './i18n.svelte'
  import { dur, slide } from './motion'
  import Select from './Select.svelte'
  import { invoke, isDesktop } from './tauri'
  import { viewport } from './viewport.svelte'
  import Hint from './Hint.svelte'
  import { canDictate, type Engine, engines } from './dictation/engines.svelte'
  import { local } from './dictation/local.svelte'

  let keyed = $state<Record<string, boolean>>({})
  let models = $state<Record<string, string[]>>({})
  let asking = $state('')
  let trouble = $state<Record<string, string>>({})
  let inFile = $state(false)
  const EXAMPLE_URL = 'http://localhost:11434'

  const named = (vendor: string) => vendorName(vendor, ai.accounts)

  const ready = (provider: Provider) =>
    provider.kind === 'chatgpt'
      ? !__EVEN_PLUGIN__ && !!plans.chatgpt
      : (keyed[provider.id] ?? false)

  const addable = $derived(
    offeredKinds(isDesktop, __CLAUDE_CODE__).filter(
      (kind) => repeatable(kind) || !ai.accounts.some((one) => one.kind === kind),
    ),
  )

  onMount(() => {
    for (const account of ai.accounts) void ask(account)
    const lookFile = () => void keysInFile().then((found) => (inFile = found))
    lookFile()
    return keysMoved(lookFile)
  })

  async function ask(account: Provider) {
    if (__EVEN_PLUGIN__) return
    const { kind } = account
    if (isLocal(kind)) await plans.check({ id: account.id, kind })
    if (kind === 'chatgpt') await plans.checkChatgpt()
  }

  $effect(() => {
    for (const account of ai.accounts) {
      if (!isLocal(account.kind) && account.kind !== 'chatgpt') void look(account.id)
    }
  })

  async function look(id: string) {
    const found = await hasKey(id).catch((error: unknown) => {
      if (error instanceof NoWord) void wordSaid().then(() => look(id))
      return error instanceof NoWord ? undefined : false
    })
    if (found !== undefined) keyed = { ...keyed, [id]: found }
  }

  async function take(provider: Provider, typed: string) {
    trouble = { ...trouble, [provider.id]: '' }

    try {
      await writeKey(provider.id, typed)
      await look(provider.id)
      await refresh(provider)
    } catch (error) {
      trouble = { ...trouble, [provider.id]: message(error, t('that key could not be saved')) }
    }
  }

  async function drop(provider: Provider) {
    try {
      await forgetKey(provider.id)
    } catch (error) {
      trouble = { ...trouble, [provider.id]: message(error, t('that key could not be saved')) }
    }
    await look(provider.id)
  }

  async function refresh(provider: Provider) {
    if (!reachable(provider, ready(provider))) return

    asking = provider.id
    trouble = { ...trouble, [provider.id]: '' }

    try {
      const found = await listModels(provider)
      models = { ...models, [provider.id]: found }
      const first = firstModel(provider.kind, found)
      if (!provider.model && first) ai.update(provider.id, { model: first })
    } catch (error) {
      trouble = { ...trouble, [provider.id]: message(error, t('Could not read the models.')) }
    } finally {
      asking = ''
    }
  }

  const said = (provider: Provider) => (text: string) => {
    trouble = { ...trouble, [provider.id]: text }
  }

  function add(kind: ProviderKind) {
    const made = ai.add(kind)
    void ai.written().then(() => ask(made))
  }

  function forget(provider: Account) {
    const { kind } = provider
    if (!isLocal(kind) && kind !== 'chatgpt') void drop(provider)
    if (!__EVEN_PLUGIN__ && isLocal(kind) && provider.own) {
      void invoke('ai_cli_forget', { tool: kind, account: provider.id }).catch((error: unknown) => {
        trouble = { ...trouble, [provider.id]: message(error, t('Could not sign out.')) }
      })
    }
    ai.remove(provider.id)
  }

  async function removeDevice(id: string, name: string) {
    const { prompt } = await import('./prompt.svelte')
    const sure = await prompt.confirm({
      title: t('Remove {name}?', { name }),
      detail: t('The device can no longer read your AI accounts, and the others get a new key.'),
      confirmLabel: t('Remove'),
      danger: true,
    })
    if (sure) await vault.remove(id).catch(() => false)
  }

  function engineName(engine: Engine): string {
    if (engine === 'auto') return t('Auto')
    if (engine === 'local') return t('This computer')
    if (engine === 'account') return t('Orden account')
    if (engine === 'device') return t('This device')
    return ai.transcriber?.name ?? ''
  }

  function labelOf(provider: Account): string {
    if (provider.name) return provider.name
    const email = !__EVEN_PLUGIN__ && isLocal(provider.kind) ? plans.of(provider.id).account : null
    return email ?? vault.seen[provider.id] ?? accountName(provider)
  }
</script>

{#snippet defaulting(vendor: string)}
  {#if ai.defaultVendor === vendor}
    <span class="hint">{t('Default')}</span>
  {:else}
    <button class="orden-chip" onclick={() => ai.setDefault(vendor)}>{t('Make default')}</button>
  {/if}
{/snippet}

<h3>{t('Accounts')}</h3>

{#if !keysAreGuarded()}
  <div class="card">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="orden-setting setting" onclick={() => void keepBrowserInVault(!browserVault.on)}>
      <span class="name"
        ><span class="orden-named"
          >{t('Keep this browser’s keys in the vault')}<Hint
            text={t('Syncs this browser’s AI keys with your other devices through the vault.')}
          /></span
        ></span
      >
      <span
        class="orden-switch"
        class:on={browserVault.on}
        role="switch"
        tabindex="0"
        aria-checked={browserVault.on}
        aria-label={t('Keep this browser’s keys in the vault')}
        onkeydown={(event) => {
          if (event.key !== ' ' && event.key !== 'Enter') return
          event.preventDefault()
          void keepBrowserInVault(!browserVault.on)
        }}
      ></span>
    </div>
  </div>
  <p class="hint caption">
    {t(
      'Then every device’s keys are kept in this browser’s storage, where a script that got into the page could read them.',
    )}
  </p>
{/if}

{#if vault.standing === 'offered'}
  <div class="card" transition:slide={{ duration: dur(160) }}>
    <div class="orden-setting setting">
      <span class="name">
        {t('{device} offers this device your AI vault', { device: vault.offeredBy })}
      </span>
      <div class="row">
        {#if vault.digits}<span class="hint digits">{vault.digits}</span>{/if}
        <button class="orden-chip" onclick={() => void vault.join()}>{t('Join')}</button>
      </div>
    </div>
  </div>
{/if}

{#if vault.standing === 'waiting' || vault.standing === 'stranded'}
  <div class="card" transition:slide={{ duration: dur(160) }}>
    <div class="orden-setting setting">
      <span class="name">
        {vault.standing === 'waiting' ? t('Allow this device on another one') : t('Start over')}
      </span>
      <div class="row">
        {#if vault.standing === 'waiting'}
          <span class="hint digits">{vault.digits || '…'}</span>
        {:else}
          <button class="orden-chip" onclick={() => void vault.startOver()}
            >{t('Start over')}</button
          >
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if vault.standing === 'open' && vault.allowed.length}
  <h3>{t('Devices with your AI vault')}</h3>
  {#each vault.allowed as one (one.id)}
    <div class="card boxed" data-device={one.id} transition:slide={{ duration: dur(160) }}>
      <div class="orden-setting setting">
        <span class="name">{one.name}</span>
        <div class="row">
          {#if one.mine}<span class="hint">{t('This device')}</span>{/if}
          <button class="orden-chip is-quiet" onclick={() => void removeDevice(one.id, one.name)}
            >{t('Remove')}</button
          >
        </div>
      </div>
    </div>
  {/each}
{/if}

{#if ai.accounts.length}
  {#each ai.vendors as vendor (vendor)}
    {@const mine = ai.accountsOf(vendor)}
    <div
      class="orden-setting setting"
      data-vendor={vendor}
      transition:slide={{ duration: dur(160) }}
    >
      <span class="name strong"
        >{#if mine[0]}<ProviderMark account={mine[0]} />{/if}{named(vendor)}</span
      >
      <div class="row">{@render defaulting(vendor)}</div>
    </div>
    {#each mine as provider (provider.id)}
      {@const using = mine.length > 1 && ai.isActive(provider.id)}
      <div
        class="card boxed"
        class:using
        data-account={provider.id}
        transition:slide={{ duration: dur(160) }}
      >
        <div class="orden-setting setting">
          <span class="name strong">
            {provider.kind === 'compatible' ? t(KIND_NAMES.compatible) : labelOf(provider)}
          </span>
          <div class="row">
            {#if using}
              <span class="hint on">{t('In use')}</span>
            {:else if mine.length > 1}
              <button class="orden-chip" onclick={() => ai.activate(provider.id)}>{t('Use')}</button
              >
            {/if}
            <button class="orden-chip is-quiet" onclick={() => forget(provider)}
              >{t('Remove')}</button
            >
          </div>
        </div>

        {#if provider.kind !== 'compatible' && mine.length > 1}
          <label class="orden-setting setting">
            <span class="name">{t('Name')}</span>
            <input
              class="orden-field is-value"
              value={provider.name}
              placeholder={accountName({ ...provider, name: '' })}
              spellcheck="false"
              onchange={(event) => ai.update(provider.id, { name: event.currentTarget.value })}
            />
          </label>
        {/if}

        {#if provider.kind === 'compatible'}
          <label class="orden-setting setting">
            <span class="name">{t('Name')}</span>
            <input
              class="orden-field is-value"
              value={provider.name}
              placeholder={t('OpenAI-compatible')}
              spellcheck="false"
              onchange={(event) => ai.update(provider.id, { name: event.currentTarget.value })}
            />
          </label>

          <label class="orden-setting setting">
            <span class="name">{t('Base URL')}</span>
            <input
              class="orden-field is-value"
              value={provider.baseUrl ?? ''}
              placeholder={EXAMPLE_URL}
              spellcheck="false"
              autocapitalize="off"
              autocorrect="off"
              autocomplete="off"
              onchange={(event) => {
                ai.update(provider.id, { baseUrl: event.currentTarget.value })
                void refresh({ ...provider, baseUrl: event.currentTarget.value })
              }}
            />
          </label>
        {/if}

        {#if !__EVEN_PLUGIN__ && (provider.kind === 'claude-code' || provider.kind === 'codex' || provider.kind === 'gemini-cli')}
          <PlanRows {provider} kind={provider.kind} {refresh} trouble={said(provider)} />
        {:else}
          {#if !__EVEN_PLUGIN__ && provider.kind === 'chatgpt'}
            <PlanRows {provider} kind="chatgpt" {refresh} trouble={said(provider)} />
          {:else}
            <div class="orden-setting setting">
              <span class="name">{t('API key')}</span>
              {#if keyed[provider.id]}
                <div class="row">
                  <span class="hint">{t('Set')}</span>
                  <button class="orden-chip is-quiet" onclick={() => void drop(provider)}
                    >{t('Remove')}</button
                  >
                </div>
              {:else}
                <input
                  class="orden-field is-value"
                  type="password"
                  value=""
                  placeholder={provider.kind === 'compatible'
                    ? t('Optional')
                    : provider.kind === 'gemini'
                      ? 'AIza'
                      : 'sk-'}
                  spellcheck="false"
                  autocomplete="off"
                  onchange={(event) => {
                    const typed = event.currentTarget.value
                    event.currentTarget.value = ''
                    void take(provider, typed)
                  }}
                />
              {/if}
            </div>
          {/if}

          <div class="orden-setting setting">
            <span class="name">{t('Model')}</span>
            {#if models[provider.id]?.length}
              <div class="orden-setting-value">
                <Select
                  value={provider.model}
                  options={(models[provider.id] ?? []).map((one) => ({ value: one, label: one }))}
                  onchange={(value: string) => ai.update(provider.id, { model: value })}
                  label={t('Model')}
                  plain={viewport.touch}
                />
              </div>
            {:else}
              <div class="row">
                {#if provider.model}<span class="hint">{provider.model}</span>{/if}
                <button
                  class="orden-chip"
                  disabled={asking === provider.id || !reachable(provider, ready(provider))}
                  onclick={() => void refresh(provider)}
                >
                  {asking === provider.id ? t('Asking…') : t('List models')}
                </button>
              </div>
            {/if}
          </div>
        {/if}

        {#if !__EVEN_PLUGIN__ && provider.kind === 'chatgpt' && plans.chatgpt}
          <p class="hint">{t('Using ChatGPT plan')}</p>
        {/if}
        {#if trouble[provider.id]}
          <p class="hint bad">{trouble[provider.id]}</p>
        {/if}
      </div>
    {/each}
  {/each}
{:else}
  <p class="hint">{t('No providers yet.')}</p>
{/if}

<div class="card">
  {#each addable as kind (kind)}
    <button class="orden-action adding" onclick={() => add(kind)}>
      <ProviderMark account={{ kind, name: '' }} />
      {t('Add {name}', { name: t(KIND_NAMES[kind]) })}
    </button>
  {/each}
</div>

{#if ai.vendors.length > 1}
  <h3 transition:slide={{ duration: dur(160) }}>{t('Used for')}</h3>
  <div class="card" transition:slide={{ duration: dur(160) }}>
    {#each FEATURES as feature (feature.id)}
      <div class="orden-setting setting">
        <span class="name"
          ><span class="orden-named"
            >{t(feature.label)}<Hint
              text={t('Which of your AI accounts this feature asks.')}
            /></span
          ></span
        >
        <div class="orden-setting-value">
          <Select
            value={ai.uses[feature.id] ?? ''}
            options={[
              { value: '', label: t('Default') },
              ...ai.vendors.map((one) => ({ value: one, label: named(one) })),
            ]}
            onchange={(value: string) => ai.use(feature.id, value)}
            label={t(feature.label)}
            plain={viewport.touch}
          />
        </div>
      </div>
    {/each}
  </div>
{/if}

{#if canDictate()}
  <h3>{t('Dictation')}</h3>
  <div class="card">
    <div class="orden-setting setting">
      <span class="name"
        ><span class="orden-named"
          >{t('Dictate with')}<Hint
            text={t('Where your voice goes to be turned into words.')}
          /></span
        ></span
      >
      <div class="orden-setting-value">
        <Select
          value={engines.chosen ?? ''}
          options={[
            { value: '', label: t('Ask on first use') },
            ...engines.offered().map((one) => ({ value: one, label: engineName(one) })),
          ]}
          onchange={(value: string) =>
            engines.choose(engines.offered().find((one) => one === value) ?? null)}
          label={t('Dictate with')}
          plain={viewport.touch}
        />
      </div>
    </div>
    {#if local.fits}
      <div class="orden-setting setting">
        <span class="name"
          ><span class="orden-named"
            >{t('Speech model')}<Hint
              text={t('{model}, on this computer. Nothing you say leaves it.', {
                model: local.machine?.model.name ?? '',
              })}
            /></span
          ></span
        >
        <div class="orden-setting-value">
          {#if local.fetching}
            <span class="caption"
              >{t('Downloading {percent}%', {
                percent: Math.floor(
                  (100 * local.fetching.done) / Math.max(1, local.fetching.total),
                ),
              })}</span
            >
          {:else if local.ready}
            <button class="orden-chip is-quiet" onclick={() => void local.remove()}
              >{t('Remove')}</button
            >
          {:else}
            <button class="orden-chip" onclick={() => void local.fetch()}
              >{t('Download ({size})', {
                size: `${Math.round((local.machine?.model.bytes ?? 0) / 1e6)} MB`,
              })}</button
            >
          {/if}
        </div>
      </div>
      {#if local.trouble}
        <p class="hint caption">{local.trouble}</p>
      {/if}
    {/if}
  </div>
{/if}

{#if !__EVEN_PLUGIN__}
  {#await import('./ai/DoWithAiCard.svelte') then card}
    <card.default />
  {/await}
{/if}

<p class="hint caption">
  {#if vault.standing === 'open'}
    {t('On every device you sign in to, end-to-end encrypted.')}
  {:else if !keysAreGuarded()}
    {t('This browser holds the keys in its own storage.')}
  {:else if vault.standing === 'off'}
    {t('Sign in to have them on every device.')}
  {/if}
</p>
{#if inFile}
  <p class="hint caption" role="note">
    {t('No keyring was found on this device, so your keys are kept in a file only you can read.')}
  </p>
{/if}
<p class="hint caption">{t('AI can be wrong. Check the facts.')}</p>

{#if glassesKey.set}
  <h3>{t('OpenAI key')}</h3>
  <div class="card">
    <div class="orden-setting setting">
      <span class="name">{t('Used by the glasses')}</span>
      <span class="hint">{t('set, ends in …{tail}', { tail: glassesKey.tail })}</span>
    </div>
  </div>
  <p class="hint caption">{t('Kept encrypted on your account, and never shown again.')}</p>
{/if}

<style>
  h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--muted-strong);
  }

  h3:first-child,
  :global(h2) + h3 {
    margin-top: 0;
  }

  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .setting .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .hint.bad {
    color: var(--danger);
  }

  .hint.caption {
    padding: 0 2px;
  }

  .strong {
    font-weight: 600;
  }

  .name > :global(.mark) {
    margin-inline-end: var(--space-2);
  }

  .adding {
    gap: var(--space-2);
  }

  .hint.on {
    color: var(--accent);
  }

  .digits {
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
  }

  .boxed {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .boxed > p.hint {
    padding-block: var(--space-2);
  }

  .boxed.using {
    border-color: var(--accent);
  }

  :global(.sheet.phone) .card {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }

  :global(.sheet.phone) .boxed {
    padding: 0;
  }

  :global(.sheet.phone) .boxed.using {
    border-color: var(--accent);
  }

  :global(.sheet.phone) .boxed > p.hint {
    padding: var(--space-2) var(--touch-pad);
  }

  :global(.sheet.phone) .setting {
    position: relative;
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }
</style>
