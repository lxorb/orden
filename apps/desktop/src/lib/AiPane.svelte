<script lang="ts">
  import {
    localDate,
    localNumber,
    NoWord,
    wordSaid,
    dur,
    slide,
    invoke,
    isDesktop,
  } from './platform/src/api'
  import { onMount } from 'svelte'
  import {
    accountName,
    vendorName,
    type Account,
    repeatable,
    vendorOf,
    AddAccount,
    FEATURES,
    ai,
    listModels,
    forgetKey,
    hasKey,
    keysAreGuarded,
    keysInFile,
    onKeysMoved,
    writeKey,
    localCli,
    loadPlanRows,
    type LocalPlans,
    USAGE_EVERY,
    usage,
    type Weekly,
    browserVault,
    keepBrowserInVault,
    vault,
    ProviderMark,
    firstModel,
    isLocal,
    offeredKinds,
    type Provider,
  } from './ai-providers/src/api'
  import type { Adding } from './ai-providers/src/api'
  import { glassesKey } from './accounts/src/api'
  import { message } from './ui-kit/src/api'
  import { Select } from './ui-controls/src/api'
  import { viewport } from './ui-kit/src/api'
  import { Hint } from './ui-controls/src/api'
  import { Switch } from './ui-controls/src/api'
  import { canDictate, type Engine, engines, local } from './dictation/src/api'

  let keyed = $state<Record<string, boolean>>({})
  let adding = $state(false)
  let trouble = $state<Record<string, string>>({})
  let inFile = $state(false)
  const EXAMPLE_URL = 'http://localhost:11434'

  const named = (vendor: string) => vendorName(vendor, ai.accounts)

  const addable = $derived(
    offeredKinds(isDesktop, __CLAUDE_CODE__).filter(
      (kind) => repeatable(kind) || !ai.accounts.some((one) => one.kind === kind),
    ),
  )

  let plans = $state.raw<LocalPlans | null>(null)
  const plansHeld = __EVEN_PLUGIN__
    ? Promise.resolve(null)
    : localCli().then((one) => (plans = one.plans))

  onMount(() => {
    for (const account of ai.accounts) void ask(account)
    const lookFile = () => void keysInFile().then((found) => (inFile = found))
    lookFile()
    const measuring = setInterval(() => {
      for (const account of ai.accounts) void usage.look(account)
    }, USAGE_EVERY)
    const unhear = onKeysMoved(lookFile)
    return () => {
      clearInterval(measuring)
      unhear()
    }
  })

  async function ask(account: Provider) {
    if (__EVEN_PLUGIN__) return
    const { kind } = account
    const held = await plansHeld
    if (isLocal(kind)) await held?.check({ id: account.id, kind })
    if (kind === 'chatgpt') await held?.checkChatgpt()
  }

  $effect(() => {
    for (const account of ai.accounts) {
      if (!isLocal(account.kind) && account.kind !== 'chatgpt') void look(account.id)
    }
  })

  $effect(() => {
    for (const account of ai.accounts) {
      if (!__EVEN_PLUGIN__ && isLocal(account.kind) && plans?.of(account.id).state === 'in') {
        void usage.look(account)
      }
    }
  })

  async function look(id: string) {
    const found = await hasKey(id).catch((error: unknown) => {
      if (error instanceof NoWord) void wordSaid().then(() => look(id))
      return error instanceof NoWord ? undefined : false
    })
    if (found !== undefined) keyed = { ...keyed, [id]: found }
  }

  async function take(provider: Provider, typed: string): Promise<string> {
    trouble = { ...trouble, [provider.id]: '' }

    try {
      await writeKey(provider.id, typed)
      await look(provider.id)
    } catch (error) {
      const said = message(error, 'that key could not be saved')
      trouble = { ...trouble, [provider.id]: said }
      return said
    }
    await refresh(provider)
    return ''
  }

  async function drop(provider: Provider) {
    try {
      await forgetKey(provider.id)
    } catch (error) {
      trouble = { ...trouble, [provider.id]: message(error, 'that key could not be saved') }
    }
    await look(provider.id)
  }

  async function refresh(provider: Provider) {
    if (isLocal(provider.kind)) {
      void usage.look(provider, true)
      return
    }
    try {
      const found = await listModels(provider)
      const first = firstModel(provider.kind, found)
      const now = ai.accounts.find((one) => one.id === provider.id)
      if (now && !now.model && first) ai.update(provider.id, { model: first })
    } catch (error) {
      trouble = { ...trouble, [provider.id]: message(error, 'Could not read the models.') }
    }
  }

  const said = (provider: Provider) => (text: string) => {
    trouble = { ...trouble, [provider.id]: text }
  }

  async function add({ kind, key, name, baseUrl }: Adding): Promise<string | null> {
    const held = __EVEN_PLUGIN__ || kind !== 'chatgpt' ? null : await plansHeld
    if (held && !held.chatgpt) {
      try {
        await invoke('chatgpt_sign_in')
        await held.checkChatgpt()
      } catch (error) {
        const said = error instanceof Error ? error.message : String(error)
        if (said === 'stopped') return ''
        return said === 'timed out'
          ? 'Could not sign in.'
          : message(new Error(said), 'Could not sign in.')
      }
    }
    const made = ai.add(kind)
    if (kind === 'compatible') ai.update(made.id, { name, baseUrl })
    await ai.written()
    const account = ai.accounts.find((one) => one.id === made.id) ?? made
    if (key) {
      const said = await take(account, key)
      if (said) return said
    } else if (kind === 'compatible' || kind === 'chatgpt') {
      void refresh(account)
    }
    void ask(account)
    return null
  }

  function fullness(week: Weekly): 'fine' | 'near' | 'full' {
    if (week.used >= 90) return 'full'
    return week.used >= 75 ? 'near' : 'fine'
  }

  function weekWords(week: Weekly): { used: string; resets: string } {
    return {
      used: `${localNumber(week.used / 100, { style: 'percent', maximumFractionDigits: 0 })} used this week`,
      resets:
        week.resets === null
          ? ''
          : `Resets ${localDate(week.resets, { weekday: 'long', hour: '2-digit', minute: '2-digit' })}`,
    }
  }

  function forget(provider: Account) {
    const { kind } = provider
    if (!isLocal(kind) && kind !== 'chatgpt') void drop(provider)
    if (!__EVEN_PLUGIN__ && isLocal(kind) && provider.own) {
      void invoke('ai_cli_forget', { tool: kind, account: provider.id }).catch((error: unknown) => {
        trouble = { ...trouble, [provider.id]: message(error, 'Could not sign out.') }
      })
    }
    usage.forget(provider.id)
    ai.remove(provider.id)
  }

  async function removeDevice(id: string, name: string) {
    const { prompt } = await import('./ui-kit/src/api')
    const sure = await prompt.confirm({
      title: `Remove ${name}?`,
      detail: 'The device can no longer read your AI accounts, and the others get a new key.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (sure) await vault.remove(id).catch(() => false)
  }

  function engineName(engine: Engine): string {
    if (engine === 'auto') return 'Auto'
    if (engine === 'local') return 'This computer'
    if (engine === 'account') return 'Orden account'
    if (engine === 'device') return 'This device'
    return ai.transcriber?.name ?? ''
  }

  function labelOf(provider: Account): string {
    if (provider.name) return provider.name
    const email =
      !__EVEN_PLUGIN__ && isLocal(provider.kind) ? (plans?.of(provider.id).account ?? null) : null
    return email ?? vault.seen[provider.id] ?? accountName(provider)
  }
</script>

<h3>Accounts</h3>

{#if !keysAreGuarded()}
  <div class="card">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="orden-setting setting" onclick={() => void keepBrowserInVault(!browserVault.on)}>
      <span class="name"
        ><span class="orden-named"
          >Keep this browser’s keys in the vault<Hint
            text="Syncs this browser’s AI keys with your other devices through the vault."
          /></span
        ></span
      >
      <Switch
        on={browserVault.on}
        label="Keep this browser’s keys in the vault"
        onchange={(on: boolean) => void keepBrowserInVault(on)}
      />
    </div>
  </div>
  <p class="hint caption">
    Then every device’s keys are kept in this browser’s storage, where a script that got into the
    page could read them.
  </p>
{/if}

{#if vault.standing === 'offered'}
  <div class="card" transition:slide={{ duration: dur(160) }}>
    <div class="orden-setting setting">
      <span class="name">
        {vault.offeredBy} offers this device your AI vault
      </span>
      <div class="row">
        {#if vault.digits}<span class="hint digits">{vault.digits}</span>{/if}
        <button class="orden-chip" onclick={() => void vault.join()}>Join</button>
      </div>
    </div>
  </div>
{/if}

{#if vault.standing === 'waiting' || vault.standing === 'stranded'}
  <div class="card" transition:slide={{ duration: dur(160) }}>
    <div class="orden-setting setting">
      <span class="name">
        {vault.standing === 'waiting' ? 'Allow this device on another one' : 'Start over'}
      </span>
      <div class="row">
        {#if vault.standing === 'waiting'}
          <span class="hint digits">{vault.digits || '…'}</span>
        {:else}
          <button class="orden-chip" onclick={() => void vault.startOver()}>Start over</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#if vault.standing === 'open' && vault.allowed.length}
  <h3>Devices with your AI vault</h3>
  {#each vault.allowed as one (one.id)}
    <div class="card boxed" data-device={one.id} transition:slide={{ duration: dur(160) }}>
      <div class="orden-setting setting">
        <span class="name">{one.name}</span>
        <div class="row">
          {#if one.mine}<span class="hint">This device</span>{/if}
          <button class="orden-chip is-quiet" onclick={() => void removeDevice(one.id, one.name)}
            >Remove</button
          >
        </div>
      </div>
    </div>
  {/each}
{/if}

{#if ai.accounts.length}
  {#each ai.accounts as provider (provider.id)}
    {@const fallback = ai.defaultAccount?.id === provider.id}
    {@const siblings = ai.accountsOf(vendorOf(provider)).length}
    {@const week = usage.of(provider.id)}
    <div
      class="card boxed"
      class:fallback
      data-account={provider.id}
      transition:slide={{ duration: dur(160) }}
    >
      <div class="orden-setting setting">
        <span class="name strong"
          ><ProviderMark account={provider} />{named(vendorOf(provider))}</span
        >
        <div class="row">
          {#if fallback}
            <span class="hint on">Default</span>
          {:else}
            <button class="orden-chip" onclick={() => ai.setDefault(provider.id)}
              >Make default</button
            >
          {/if}
          <button class="orden-chip is-quiet" onclick={() => forget(provider)}>Remove</button>
        </div>
      </div>

      {#if isLocal(provider.kind)}
        <div class="orden-setting setting">
          <span class="name">{labelOf(provider)}</span>
        </div>
      {/if}

      {#if provider.kind !== 'compatible' && siblings > 1}
        <label class="orden-setting setting">
          <span class="name">Name</span>
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
          <span class="name">Name</span>
          <input
            class="orden-field is-value"
            value={provider.name}
            placeholder="OpenAI-compatible"
            spellcheck="false"
            onchange={(event) => ai.update(provider.id, { name: event.currentTarget.value })}
          />
        </label>

        <label class="orden-setting setting">
          <span class="name">Base URL</span>
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

      {#if !__EVEN_PLUGIN__ && (provider.kind === 'claude-code' || provider.kind === 'codex' || provider.kind === 'gemini-cli' || provider.kind === 'chatgpt')}
        {#await loadPlanRows() then { default: PlanRows }}
          <PlanRows {provider} kind={provider.kind} {refresh} trouble={said(provider)} />
        {/await}
      {:else}
        <div class="orden-setting setting">
          <span class="name">API key</span>
          {#if keyed[provider.id]}
            <div class="row">
              <span class="hint">Set</span>
              <button class="orden-chip is-quiet" onclick={() => void drop(provider)}>Remove</button
              >
            </div>
          {:else}
            <input
              class="orden-field is-value"
              type="password"
              value=""
              placeholder={provider.kind === 'compatible'
                ? 'Optional'
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

      {#if week}
        {@const words = weekWords(week)}
        <div class="week" data-week>
          <div
            class="orden-meter"
            class:is-near={fullness(week) === 'near'}
            class:is-full={fullness(week) === 'full'}
            role="progressbar"
            aria-label={words.used}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(week.used)}
          >
            <div class="orden-meter-fill" style:width="{week.used}%"></div>
          </div>
          <div class="week-words">
            <span>{words.used}</span>
            {#if words.resets}<span>{words.resets}</span>{/if}
          </div>
        </div>
      {/if}

      {#if !__EVEN_PLUGIN__ && provider.kind === 'chatgpt' && plans?.chatgpt}
        <p class="hint">Using ChatGPT plan</p>
      {/if}
      {#if trouble[provider.id]}
        <p class="hint bad">{trouble[provider.id]}</p>
      {/if}
    </div>
  {/each}
{:else}
  <p class="hint">No providers yet.</p>
{/if}

{#if addable.length}
  <div class="card">
    <button class="orden-action adding" data-add-account onclick={() => (adding = true)}>
      Add
    </button>
  </div>
{/if}

<AddAccount open={adding} offered={addable} onadd={add} onclose={() => (adding = false)} />

{#if ai.vendors.length > 1}
  <h3 transition:slide={{ duration: dur(160) }}>Used for</h3>
  <div class="card" transition:slide={{ duration: dur(160) }}>
    {#each FEATURES as feature (feature.id)}
      <div class="orden-setting setting">
        <span class="name"
          ><span class="orden-named"
            >{feature.label}<Hint text="Which of your AI accounts this feature asks." /></span
          ></span
        >
        <div class="orden-setting-value">
          <Select
            value={ai.uses[feature.id] ?? ''}
            options={[
              { value: '', label: 'Default' },
              ...ai.vendors.map((one) => ({ value: one, label: named(one) })),
            ]}
            onchange={(value: string) => ai.use(feature.id, value)}
            label={feature.label}
            plain={viewport.touch}
          />
        </div>
      </div>
    {/each}
  </div>
{/if}

{#if canDictate()}
  <h3>Dictation</h3>
  <div class="card">
    <div class="orden-setting setting">
      <span class="name"
        ><span class="orden-named"
          >Dictate with<Hint text="Where your voice goes to be turned into words." /></span
        ></span
      >
      <div class="orden-setting-value">
        <Select
          value={engines.chosen ?? ''}
          options={[
            { value: '', label: 'Ask on first use' },
            ...engines.offered().map((one) => ({ value: one, label: engineName(one) })),
          ]}
          onchange={(value: string) =>
            engines.choose(engines.offered().find((one) => one === value) ?? null)}
          label="Dictate with"
          plain={viewport.touch}
        />
      </div>
    </div>
    {#if local.fits}
      <div class="orden-setting setting">
        <span class="name"
          ><span class="orden-named"
            >Speech model<Hint
              text="{local.machine?.model.name ?? ''}, on this computer. Nothing you say leaves it."
            /></span
          ></span
        >
        <div class="orden-setting-value">
          {#if local.fetching}
            <span class="caption"
              >Downloading {Math.floor(
                (100 * local.fetching.done) / Math.max(1, local.fetching.total),
              )}%</span
            >
          {:else if local.ready}
            <button class="orden-chip is-quiet" onclick={() => void local.remove()}>Remove</button>
          {:else}
            <button class="orden-chip" onclick={() => void local.fetch()}
              >Download ({Math.round((local.machine?.model.bytes ?? 0) / 1e6)} MB)</button
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

{#if vault.standing !== 'open' && (!keysAreGuarded() || vault.standing === 'off')}
  <p class="hint caption">
    {#if !keysAreGuarded()}
      This browser holds the keys in its own storage.
    {:else}
      Sign in to have them on every device.
    {/if}
  </p>
{/if}
{#if inFile}
  <p class="hint caption" role="note">
    No keyring was found on this device, so your keys are kept in a file only you can read.
  </p>
{/if}

{#if glassesKey.set}
  <h3>OpenAI key</h3>
  <div class="card">
    <div class="orden-setting setting">
      <span class="name">Used by the glasses</span>
      <span class="hint">set, ends in …{glassesKey.tail}</span>
    </div>
  </div>
  <p class="hint caption">Kept encrypted on your account, and never shown again.</p>
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

  .boxed.fallback {
    border-color: var(--accent);
  }

  .week {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-block: var(--space-2);
  }

  .week-words {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
    color: var(--muted);
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

  :global(.sheet.phone) .boxed.fallback {
    border-color: var(--accent);
  }

  :global(.sheet.phone) .boxed > p.hint,
  :global(.sheet.phone) .week {
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
