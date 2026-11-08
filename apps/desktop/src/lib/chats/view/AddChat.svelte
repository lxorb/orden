<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte'
  import type { ChatProvider, ConnectField, Conversation } from '@orden/chats/provider'
  import { t } from '../../i18n.svelte'
  import { openExternal } from '../../tauri'
  import { closeOnBack } from '../../backstack.svelte'
  import { connected } from '../connected.svelte'
  import { accounts, openConversation } from '../linked'
  import { host } from '../providers/host'
  import { screens } from '../providers/screens.svelte'
  import { adding, closeAdding, mayLeave, watchClosing } from './adding.svelte'
  import { ADVANCED, fixFor, introOf, isOAuth, pairingSteps, submitOf, tileHint } from './add-steps'
  import SignIn from './SignIn.svelte'
  import Avatar from '../../people/Avatar.svelte'
  import { firstLine } from './body'
  import { conversationTitle } from './title'

  const labels: Record<string, string> = {
    address: t('Email address'),
    password: t('Password'),
    name: t('Your name'),
    imapHost: t('IMAP server'),
    smtpHost: t('SMTP server'),
    user: t('User name'),
    phone: t('Phone number'),
    token: t('User token'),
    appToken: t('App-level token'),
    device: t('Device name'),
  }

  const offered = $derived(accounts.offered.filter((one) => one.available(host)))
  const provider = $derived(adding.provider)
  const step = $derived(adding.step)
  const busy = $derived(adding.busy)
  let frame = $state<HTMLElement | null>(null)

  watchClosing()

  $effect(() => {
    const now = step
    const at = frame
    if (!at) return
    void tick().then(() => {
      if (adding.step !== now || at.contains(document.activeElement)) return
      const first = now === 'connect' ? at.querySelector<HTMLElement>('input, select') : null
      ;(first ?? at).focus({ preventScroll: true })
    })
  })

  $effect(() => {
    if (adding.asked !== adding.seen) untrack(() => adding.takeAsk())
  })

  $effect.pre(() => closeOnBack(step !== 'choose' && !busy, back))

  const intro = $derived(provider ? introOf(provider.id) : null)
  const pairing = $derived(provider ? pairingSteps(provider.id) : [])
  const main = $derived(provider?.fields.filter((one) => !ADVANCED.has(one.key)) ?? [])
  const extra = $derived(provider?.fields.filter((one) => ADVANCED.has(one.key)) ?? [])
  const ready = $derived(adding.ready)
  const linked = $derived(
    adding.account ? connected.find(adding.account.provider, adding.account.account) : undefined,
  )
  const listed = $derived<readonly Conversation[]>(
    (linked?.conversations ?? [])
      .filter((one) => !one.archived && (one.lastAt !== null || !!one.snippet))
      .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
      .slice(0, 12),
  )
  let pictures = $state<Record<string, string>>({})
  const asked: Record<string, true> = {}

  $effect(() => {
    if (step !== 'done' || adding.settled) return
    const count = linked?.conversations.length ?? 0
    if (!count) return
    const quiet = setTimeout(() => (adding.settled = true), SETTLE_QUIET)
    return () => clearTimeout(quiet)
  })

  $effect(() => {
    if (step !== 'done' || adding.settled) return
    const most = setTimeout(() => (adding.settled = true), SETTLE_MOST)
    return () => clearTimeout(most)
  })

  $effect(() => {
    if (step !== 'done' || !adding.settled || adding.chosen.length || !listed.length) return
    untrack(() => (adding.chosen = listed.slice(0, 3).map((one) => one.id)))
  })

  $effect(() => {
    const connection = linked?.connection
    if (step !== 'done' || !adding.settled || !connection?.picture) return
    for (const one of listed) {
      const wanted = `${adding.account?.account ?? ''}:${one.id}`
      if (asked[wanted]) continue
      asked[wanted] = true
      const id =
        one.picture ?? (one.kind === 'direct' ? one.people[0]?.picture : undefined) ?? one.id
      void connection
        .picture(id)
        .then((bytes) => {
          if (!bytes?.length) return
          pictures = { ...pictures, [wanted]: URL.createObjectURL(new Blob([bytes.slice()])) }
        })
        .catch(() => undefined)
    }
  })

  onDestroy(() => {
    for (const url of Object.values(pictures)) URL.revokeObjectURL(url)
  })

  function pictureOf(one: Conversation): string | undefined {
    return pictures[`${adding.account?.account ?? ''}:${one.id}`]
  }

  function typeOf(field: ConnectField): string {
    switch (field.kind) {
      case 'password':
        return 'password'
      case 'email':
        return 'email'
      case 'phone':
        return 'tel'
      case 'url':
        return 'url'
      case 'number':
        return 'number'
      case 'text':
      case 'select':
        return 'text'
    }
  }

  function connect(event?: SubmitEvent) {
    event?.preventDefault()
    void adding.connect()
  }

  function back() {
    adding.back()
  }

  async function cancel() {
    if (adding.busy) adding.stop()
    if (!(await mayLeave())) return
    adding.again = null
    closeAdding()
  }

  function finish() {
    const done = adding.account
    const opening = listed.filter((one) => adding.chosen.includes(one.id))
    closeAdding()
    if (!done) return
    for (const [index, one] of opening.entries()) {
      openConversation(
        { provider: done.provider, account: done.account, conversation: one.id },
        conversationTitle(one),
        { activate: index === 0 },
      )
    }
  }

  function toggle(id: string) {
    const chosen = adding.chosen
    adding.chosen = chosen.includes(id) ? chosen.filter((one) => one !== id) : [...chosen, id]
  }

  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    if (step === 'choose' || (step === 'connect' && adding.replacing !== undefined)) void cancel()
    else back()
  }

  const NUMBERS = ['choose', 'connect', 'check', 'done'] as const
  const SETTLE_QUIET = 2000
  const SETTLE_MOST = 15_000
</script>

{#snippet mark(one: ChatProvider, size: 'big' | 'small')}
  <span class="mark {size}" aria-hidden="true"
    ><svg viewBox="0 0 24 24"><path d={one.icon} /></svg></span
  >
{/snippet}

{#snippet field(one: ConnectField)}
  {@const id = `${provider?.id ?? ''}:${one.key}`}
  {#if one.help}
    {@const help = one.help}
    <div class="guide">
      <p class="guide-title">{t(help.label)}</p>
      {#if help.steps?.length}
        <ol>
          {#each help.steps as line (line)}<li>{t(line)}</li>{/each}
        </ol>
      {/if}
      <button
        type="button"
        class="orden-button is-quiet"
        onclick={() => void openExternal(help.url)}>{t('Open in the browser')}</button
      >
    </div>
  {/if}
  <label class="field">
    <span class="label">{labels[one.key] ?? t(one.label)}</span>
    {#if one.kind === 'select'}
      <select
        class="orden-field"
        value={adding.valueOf(one)}
        onchange={(event) => (adding.values[id] = event.currentTarget.value)}
      >
        {#each one.options ?? [] as option (option.value)}
          <option value={option.value}>{t(option.label)}</option>
        {/each}
      </select>
    {:else}
      <input
        class="orden-field"
        type={typeOf(one)}
        inputmode={one.kind === 'phone' ? 'tel' : undefined}
        autocomplete={one.kind === 'password'
          ? 'current-password'
          : one.kind === 'phone'
            ? 'tel'
            : one.kind === 'email'
              ? 'email'
              : 'off'}
        placeholder={one.placeholder ? t(one.placeholder) : undefined}
        spellcheck="false"
        value={adding.valueOf(one)}
        oninput={(event) => (adding.values[id] = event.currentTarget.value)}
      />
    {/if}
    {#if one.note}<span class="note">{t(one.note)}</span>{/if}
  </label>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={frame}
  class="add-chat"
  tabindex="-1"
  role="region"
  aria-label={t('Add a chat account')}
  data-region="editor"
  data-step={step}
  onkeydown={keydown}
>
  <div class="frame">
    <header class="head">
      {#if step !== 'choose' && !(step === 'connect' && adding.replacing !== undefined)}
        <button type="button" class="orden-glyph" aria-label={t('Back')} onclick={back}>
          <svg class="orden-mirror" viewBox="0 0 16 16"><path d="M10 3L5 8l5 5" /></svg>
        </button>
      {/if}
      <h1>{t('Add a chat account')}</h1>
      <ol class="progress" aria-label={t('Steps')}>
        {#each NUMBERS as one, index (one)}
          <li
            class:is-on={one === step}
            class:is-past={NUMBERS.indexOf(step) > index}
            aria-current={one === step ? 'step' : undefined}
          ></li>
        {/each}
      </ol>
    </header>

    {#if step === 'choose'}
      <section class="body">
        <h2>{t('Choose a service')}</h2>
        {#if offered.length}
          <div class="tiles">
            {#each offered as one (one.id)}
              {@const hint = tileHint(one.id)}
              <button type="button" class="tile" onclick={() => adding.begin(one)}>
                {@render mark(one, 'big')}
                <span class="tile-name">{one.name}</span>
                {#if hint}<span class="tile-hint">{hint}</span>{/if}
              </button>
            {/each}
          </div>
        {:else}
          <p class="note">{t('Chat services connect in the desktop app.')}</p>
        {/if}
      </section>
    {:else if provider && step === 'connect'}
      <form class="body" onsubmit={connect}>
        <div class="title">
          {@render mark(provider, 'small')}
          <h2>{provider.name}</h2>
        </div>
        {#if intro}<p class="intro">{intro}</p>{/if}
        {#if pairing.length}
          <ol class="steps">
            {#each pairing as line (line)}<li>{line}</li>{/each}
          </ol>
        {/if}
        {#each main as one (`${provider.id}:${one.key}`)}
          {@render field(one)}
        {/each}
        {#if extra.length}
          <details class="advanced" bind:open={adding.advanced}>
            <summary>{t('Advanced')}</summary>
            <div class="servers">
              {#if adding.problem}<p class="note">
                  {t('Orden could not reach the servers it guessed. Fill them in here.')}
                </p>{/if}
              {#each extra as one (`${provider.id}:${one.key}`)}
                {@render field(one)}
              {/each}
            </div>
          </details>
        {/if}
        {#if provider.warning}
          <div class="warning" role="note">
            <p>{t(provider.warning)}</p>
            <label class="understood">
              <input type="checkbox" bind:checked={adding.understood} />
              <span>{t('I understand and want to connect anyway')}</span>
            </label>
          </div>
        {/if}
        <div class="actions">
          <button class="orden-button is-quiet" type="button" onclick={() => void cancel()}
            >{t('Cancel')}</button
          >
          <button class="orden-button" type="submit" disabled={!ready}
            >{isOAuth(provider.id)
              ? t('Sign in with {service}', { service: provider.name })
              : submitOf(provider.id)}</button
          >
        </div>
      </form>
    {:else if provider && step === 'check'}
      <section class="body">
        <div class="title">
          {@render mark(provider, 'small')}
          <h2>{busy ? t('Checking the connection…') : t('Could not connect')}</h2>
        </div>
        {#if busy}
          <SignIn />
          {#if screens.screen?.kind === 'qr' && pairing.length}
            <ol class="steps">
              {#each pairing as line (line)}<li>{line}</li>{/each}
            </ol>
          {/if}
          {#if !screens.screen && !screens.asking}
            <p class="note" role="status">{t('Connecting…')}</p>
          {/if}
        {:else if adding.problem}
          <div class="failed" role="alert">
            <p class="reason">{t(adding.problem)}</p>
            <p>{fixFor(provider.id, adding.problem)}</p>
          </div>
        {/if}
        <div class="actions">
          {#if busy}
            <button class="orden-button is-quiet" type="button" onclick={() => adding.stop()}
              >{t('Cancel')}</button
            >
          {:else}
            <button class="orden-button is-quiet" type="button" onclick={back}
              >{t('Change the details')}</button
            >
            <button class="orden-button" type="button" disabled={!ready} onclick={() => connect()}
              >{t('Try again')}</button
            >
          {/if}
        </div>
      </section>
    {:else if step === 'done' && adding.account}
      <section class="body">
        <div class="title">
          {#if provider}{@render mark(provider, 'small')}{/if}
          <h2>{t('{account} is connected', { account: adding.account.label })}</h2>
        </div>
        {#if !adding.settled}
          <p class="note" role="status">{t('Loading your chats…')}</p>
        {:else if listed.length}
          <p class="intro">{t('Choose the chats to open now. The rest wait in the sidebar.')}</p>
          <div class="chosen">
            {#each listed as one (one.id)}
              {@const title = conversationTitle(one)}
              {@const picture = pictureOf(one)}
              <label class="pick orden-row">
                <input
                  type="checkbox"
                  checked={adding.chosen.includes(one.id)}
                  onchange={() => toggle(one.id)}
                />
                <span class="face">
                  {#if picture}
                    <img src={picture} alt="" draggable="false" />
                  {:else}
                    <Avatar face={{ name: title, key: one.id }} size={32} />
                  {/if}
                </span>
                <span class="words">
                  <span class="orden-row-label">{title}</span>
                  {#if one.snippet}<span class="snippet">{firstLine(one.snippet)}</span>{/if}
                </span>
              </label>
            {/each}
          </div>
        {:else}
          <p class="intro">{t('Its chats show in the sidebar as they arrive.')}</p>
        {/if}
        <div class="actions">
          <button class="orden-button is-quiet" type="button" onclick={() => adding.reset()}
            >{t('Add another')}</button
          >
          <button class="orden-button" type="button" onclick={finish}
            >{adding.chosen.length && listed.length ? t('Open chats') : t('Done')}</button
          >
        </div>
      </section>
    {/if}
  </div>
</div>

<style>
  .add-chat {
    height: 100%;
    outline: none;
    min-height: 0;
    overflow-y: auto;
    background: var(--surface);
  }

  .frame {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 40rem;
    margin: 0 auto;
    padding: var(--space-6) var(--space-5) var(--space-7);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  h1 {
    flex: 1 1 auto;
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  h2 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    overflow-wrap: anywhere;
  }

  .progress {
    display: flex;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .progress li {
    width: 1.5rem;
    height: 4px;
    border-radius: 2px;
    background: var(--line);
  }

  .progress li.is-past {
    background: var(--accent-line);
  }

  .progress li.is-on {
    background: var(--accent);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(11rem, 100%), 1fr));
    gap: var(--space-3);
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    min-height: 8rem;
    padding: var(--space-4);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .tile:hover {
    border-color: var(--accent-line);
    background: var(--surface-hover);
  }

  .tile-name {
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .tile-hint {
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    border-radius: var(--radius-md);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .mark.big {
    width: 2.75rem;
    height: 2.75rem;
  }

  .mark.small {
    width: 2rem;
    height: 2rem;
  }

  .mark svg {
    width: 55%;
    height: 55%;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .intro,
  .note {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

  .steps,
  .guide ol {
    margin: 0;
    padding-inline-start: var(--space-5);
    color: var(--text);
    font-size: var(--text-sm);
  }

  .steps li + li,
  .guide li + li {
    margin-top: var(--space-1);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }

  .label {
    color: var(--muted-strong);
  }

  .note {
    font-size: var(--text-xs);
  }

  .guide {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .guide-title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .advanced {
    font-size: var(--text-sm);
  }

  .servers {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-2);
  }

  .advanced summary {
    color: var(--muted-strong);
    cursor: pointer;
  }

  .warning,
  .failed {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    background: var(--danger-soft);
    font-size: var(--text-sm);
  }

  .warning p,
  .failed p {
    margin: 0;
    color: var(--text-strong);
    overflow-wrap: anywhere;
  }

  .failed .reason {
    font-weight: var(--weight-strong);
  }

  .understood {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--muted-strong);
  }

  .chosen {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .pick {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-block: var(--space-1);
    cursor: pointer;
  }

  .face {
    display: inline-flex;
    flex: none;
    width: 32px;
    height: 32px;
  }

  .face img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .words {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
  }

  .snippet {
    overflow: hidden;
    color: var(--muted);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  @media (max-width: 30rem) {
    h1 {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }

    .progress {
      flex: 1 1 auto;
      justify-content: flex-end;
    }

    .frame {
      padding: var(--space-4) var(--space-3) var(--space-6);
    }

    .tiles {
      grid-template-columns: 1fr;
    }

    .tile {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      min-height: 0;
    }

    .tile-hint {
      flex-basis: 100%;
    }

    .actions > :global(*) {
      flex: 1 1 auto;
    }
  }
</style>
