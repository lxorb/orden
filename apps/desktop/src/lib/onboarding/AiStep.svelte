<script lang="ts">
  import { plans } from '../ai/local/status.svelte'
  import { t } from '../i18n.svelte'
  import { type Compatible, MORE_AI, type Plan, PLANS } from './catalog'
  import { connectCompatible, connectKey, signInKind, signInWith } from './connect'
  import { keyKindOf, type KeyedKind, matching, offersApiKey, requestKey, typedName } from './flow'
  import Logo from './Logo.svelte'
  import RequestRow from './RequestRow.svelte'
  import Screen from './Screen.svelte'
  import SearchField from './SearchField.svelte'
  import { setup } from './setup.svelte'

  type State = 'idle' | 'busy' | 'waiting' | 'in'

  const FROM_KEY: Record<KeyedKind, Plan> = {
    anthropic: 'claude',
    openai: 'chatgpt',
    gemini: 'gemini',
  }

  const offered = PLANS.filter(
    (one) => signInKind(one.id) !== null || offersApiKey(setup.answers.code),
  )

  let states = $state<Record<string, State>>({})
  let waitingOn = $state<Record<string, string>>({})
  let trouble = $state('')
  let others = $state(false)
  let query = $state('')
  let keying = $state(false)
  let typed = $state('')
  let target = $state<Compatible | null>(null)
  let field = $state<HTMLInputElement>()
  let keyTimer: ReturnType<typeof setTimeout> | undefined

  const keyOffered = offersApiKey(setup.answers.code)
  const connected = $derived(Object.values(states).includes('in'))
  const more = $derived(matching(MORE_AI, query))
  const nothing = $derived(!!query.trim() && !more.length)

  $effect(() => {
    for (const [plan, id] of Object.entries(waitingOn)) {
      if (plans.of(id).state === 'in') {
        states = { ...states, [plan]: 'in' }
        waitingOn = Object.fromEntries(Object.entries(waitingOn).filter(([one]) => one !== plan))
      }
    }
  })

  $effect(() => () => clearTimeout(keyTimer))

  async function signIn(plan: Plan) {
    if (signInKind(plan) === null) {
      openKey(null)
      return
    }
    if (states[plan] && states[plan] !== 'idle') return
    trouble = ''
    states = { ...states, [plan]: 'busy' }
    const said = await signInWith(plan)
    if (said.state === 'failed') {
      trouble = said.said
      states = { ...states, [plan]: 'idle' }
      return
    }
    if (said.state === 'waiting') waitingOn = { ...waitingOn, [plan]: said.id }
    states = { ...states, [plan]: said.state }
  }

  function openKey(to: Compatible | null) {
    keying = true
    target = to
    typed = ''
    setTimeout(() => field?.focus({ preventScroll: true }), 150)
  }

  async function connect(provider: Compatible) {
    if (provider.keyed) {
      openKey(provider)
      return
    }
    trouble = ''
    states = { ...states, [provider.id]: 'busy' }
    const said = await connectCompatible(provider, '')
    if (said) trouble = said
    states = { ...states, [provider.id]: said ? 'idle' : 'in' }
  }

  async function takeKey() {
    const key = typed.trim()
    if (!key) return
    const to = target
    const kind = to ? null : keyKindOf(key)
    if (!to && !kind) return
    const row = to ? to.id : FROM_KEY[kind ?? 'openai']
    trouble = ''
    states = { ...states, [row]: 'busy' }
    const said = to ? await connectCompatible(to, key) : await connectKey(kind ?? 'openai', key)
    if (said) trouble = said
    else {
      typed = ''
      keying = false
      target = null
    }
    states = { ...states, [row]: said ? 'idle' : 'in' }
  }

  function typing() {
    clearTimeout(keyTimer)
    if (!target && keyKindOf(typed)) keyTimer = setTimeout(() => void takeKey(), 600)
  }
</script>

{#snippet button(id: string, label: string, press: () => void)}
  {@const now = states[id] ?? 'idle'}
  {#if now === 'in'}
    <span class="done" role="status" aria-label={t('Connected')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    </span>
  {:else}
    <button
      class="orden-chip end"
      type="button"
      disabled={now !== 'idle'}
      aria-busy={now !== 'idle'}
      onclick={press}
    >
      {#if now === 'idle'}{label}{:else}<span class="spin" aria-hidden="true"></span>{/if}
    </button>
  {/if}
{/snippet}

<Screen
  title={t('Connect your AI')}
  primary={{ label: t('Continue'), disabled: !connected, onclick: () => setup.next() }}
  quiet={{ label: t('Skip'), onclick: () => setup.next() }}
>
  <div class="o-list rise">
    {#each offered as one (one.id)}
      <div class="row">
        <span class="ico"
          ><Logo name={one.name} icon={one.icon} colour={one.colour} size={17} /></span
        >
        <span>{one.name}</span>
        {@render button(
          one.id,
          signInKind(one.id) ? t('Sign in') : t('Connect'),
          () => void signIn(one.id),
        )}
      </div>
    {/each}
    {#if !others}
      <button class="row open" type="button" onclick={() => (others = true)}>
        <span class="ico"
          ><svg class="dots" viewBox="0 0 24 24" aria-hidden="true"
            ><circle cx="6" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle
              cx="18"
              cy="12"
              r="1.8"
            /></svg
          ></span
        >
        <span>{t('Other')}</span>
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
    {/if}
  </div>

  {#if others}
    <div class="o-pane pane-in">
      <SearchField
        value={query}
        onvalue={(typed: string) => (query = typed)}
        label={t('Connect your AI')}
      />
      <div class="o-list more">
        {#each more as one (one.id)}
          {#if one.baseUrl}
            <div class="row">
              <span class="ico"
                ><Logo name={one.name} icon={one.icon} colour={one.colour} size={17} /></span
              >
              <span>{one.name}</span>
              {@render button(one.id, t('Connect'), () => void connect(one))}
            </div>
          {:else}
            <RequestRow
              name={one.name}
              icon={one.icon}
              colour={one.colour}
              asked={requestKey('ai', one.name)}
            />
          {/if}
        {/each}
        {#if nothing}
          <RequestRow name={typedName(query)} asked={requestKey('ai', query)} />
        {/if}
      </div>
    </div>
  {/if}

  {#if keying}
    <form
      class="key pane-in"
      onsubmit={(event) => {
        event.preventDefault()
        void takeKey()
      }}
    >
      <input
        bind:this={field}
        bind:value={typed}
        oninput={typing}
        class="field"
        type="password"
        placeholder={t('API key')}
        aria-label={t('API key')}
        autocomplete="off"
        spellcheck="false"
      />
    </form>
  {:else if keyOffered}
    <button class="orden-button is-quiet skip" type="button" onclick={() => openKey(null)}
      >{t('Use an API key')}</button
    >
  {/if}

  {#if trouble}<p class="error" role="alert">{trouble}</p>{/if}
</Screen>

<style>
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 16px;
    border: 0;
    background: none;
    font: inherit;
    font-size: 15px;
    color: var(--text);
    text-align: start;
    position: relative;
  }

  .row + .row::before {
    content: '';
    position: absolute;
    top: 0;
    inset-inline: 16px 0;
    height: 1px;
    background: var(--line);
  }

  .open {
    cursor: pointer;
  }

  .open:hover {
    background: var(--surface-2);
  }

  .ico {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    background: var(--surface-2);
    flex: none;
  }

  .dots {
    width: 17px;
    height: 17px;
    fill: currentColor;
  }

  .chev {
    width: 16px;
    height: 16px;
    margin-inline-start: auto;
    fill: none;
    stroke: var(--muted);
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .more {
    max-height: min(34vh, 300px);
    overflow-y: auto;
  }

  .end {
    margin-inline-start: auto;
    min-width: 74px;
    min-height: 30px;
    display: inline-grid;
    place-items: center;
  }

  .done {
    margin-inline-start: auto;
    min-width: 30px;
    height: 30px;
    display: inline-grid;
    place-items: center;
    flex: none;
    color: var(--success);
    font-size: 13.5px;
    font-weight: 600;
    white-space: nowrap;
  }

  .done svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .spin {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: turn 0.7s linear infinite;
  }

  @keyframes turn {
    to {
      transform: rotate(1turn);
    }
  }

  .key {
    width: 100%;
    display: flex;
    justify-content: center;
  }

  .field {
    width: min(360px, 100%);
    height: 50px;
    border-radius: 12px;
    border: 1px solid var(--line-strong);
    background: var(--card);
    padding: 0 16px;
    font: inherit;
    font-size: 16px;
    color: var(--text);
  }

  .skip {
    color: var(--accent);
    font-size: 15px;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 14px;
    text-align: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
</style>
