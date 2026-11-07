<script lang="ts">
  import { type Breach, breachedAccount, compromisedOf } from '@orden/pass/breach'
  import { activeLogins, type Flag, report } from '@orden/pass/monitor'
  import type { IconNode } from 'lucide'
  import ChevronRight from 'lucide/dist/esm/icons/chevron-right.mjs'
  import CircleCheck from 'lucide/dist/esm/icons/circle-check.mjs'
  import EyeOff from 'lucide/dist/esm/icons/eye-off.mjs'
  import Radar from 'lucide/dist/esm/icons/radar.mjs'
  import Repeat from 'lucide/dist/esm/icons/repeat.mjs'
  import ShieldAlert from 'lucide/dist/esm/icons/shield-alert.mjs'
  import ShieldOff from 'lucide/dist/esm/icons/shield-off.mjs'
  import Smartphone from 'lucide/dist/esm/icons/smartphone.mjs'
  import { message, plural, t } from '../i18n.svelte'
  import { fetcher } from './breach-fetch'
  import { flagName } from './flag-words'
  import Glyph from './Glyph.svelte'
  import { pass } from './store.svelte'
  import type { PassUi } from './ui.svelte'

  const { ui }: { ui: PassUi } = $props()

  const found = $derived(report(pass.items, ui.compromised))
  let checking = $state(false)
  let checked = $state(false)
  let wrong = $state('')

  let key = $state('')
  let typedKey = $state('')
  let keyRead = $state(false)
  let breaches = $state.raw<Record<string, Breach[] | string>>({})

  const emails = $derived([
    ...new Set(
      activeLogins(pass.items)
        .map((one) => one.content.email.trim().toLowerCase())
        .filter((one) => one.includes('@')),
    ),
  ])

  $effect(() => {
    let current = true
    void pass.hibpKey().then((kept) => {
      if (!current) return
      key = kept
      keyRead = true
    })
    return () => {
      current = false
    }
  })

  $effect(() => {
    if (pass.settings.checkBreaches && !checked && !checking) void check()
  })

  async function check() {
    checking = true
    wrong = ''
    try {
      ui.compromised = await compromisedOf(pass.items, fetcher)
      checked = true
    } catch (error) {
      wrong = message(error, 'Have I Been Pwned could not be reached.')
      checked = true
    } finally {
      checking = false
    }
  }

  function turnOn() {
    pass.setSetting('checkBreaches', true)
  }

  async function keptKey(event: SubmitEvent) {
    event.preventDefault()
    await pass.setHibpKey(typedKey)
    key = typedKey.trim()
    typedKey = ''
  }

  async function forgetKey() {
    await pass.setHibpKey('')
    key = ''
    breaches = {}
  }

  async function lookUp() {
    const next: Record<string, Breach[] | string> = {}
    for (const email of emails) {
      try {
        next[email] = await breachedAccount(email, key, fetcher)
      } catch (error) {
        next[email] = message(error, 'Have I Been Pwned could not be reached.')
      }
      breaches = { ...next }
    }
  }

  interface Card {
    flag: Flag
    icon: IconNode
    ids: string[]
    line: string
  }

  const cards = $derived<Card[]>([
    {
      flag: 'weak',
      icon: ShieldAlert,
      ids: found.weak,
      line: t('Easy to guess. Change them to generated ones.'),
    },
    {
      flag: 'reused',
      icon: Repeat,
      ids: [...found.reused.keys()],
      line: t('Used for more than one login.'),
    },
    {
      flag: 'inactive2fa',
      icon: Smartphone,
      ids: found.inactive2fa,
      line: t('These sites offer two-factor authentication.'),
    },
    {
      flag: 'excluded',
      icon: EyeOff,
      ids: found.excluded,
      line: t('Left out of Monitor.'),
    },
  ])

  function opened(flag: Flag, ids: string[]) {
    if (!ids.length) return
    ui.flagged = ids
    ui.flag = flag
  }
</script>

{#snippet counted(count: number)}
  {#if count}
    <span class="count">{count}</span>
  {:else}
    <span class="clear"><Glyph icon={CircleCheck} /></span>
  {/if}
{/snippet}

<section class="monitor" aria-label={t('Monitor')} data-scrolls>
  <header class="head">
    <h2 class="title">{t('Monitor')}</h2>
  </header>

  <div class="cards">
    <div class="card is-first" class:is-bad={found.compromised.length > 0}>
      <button
        class="nib-row press"
        type="button"
        disabled={!found.compromised.length}
        onclick={() => opened('compromised', found.compromised)}
      >
        <span class="mark"><Glyph icon={ShieldOff} /></span>
        <span class="words">
          <span class="name">{flagName('compromised')}</span>
          <span class="line">
            {#if !pass.settings.checkBreaches}
              {t('Check your passwords against known data breaches.')}
            {:else if checking}
              {t('Checking…')}
            {:else if wrong}
              {wrong}
            {:else}
              {t('Found in a data breach. Change them now.')}
            {/if}
          </span>
        </span>
        {#if pass.settings.checkBreaches && !checking && !wrong}
          {@render counted(found.compromised.length)}
        {/if}
      </button>
      {#if !pass.settings.checkBreaches}
        <button class="nib-button check" type="button" onclick={turnOn}>{t('Check')}</button>
      {:else if wrong}
        <button class="nib-chip check" type="button" onclick={() => void check()}>
          {t('Try again')}
        </button>
      {/if}
    </div>

    {#each cards as card (card.flag)}
      <div class="card" class:is-bad={card.ids.length > 0 && card.flag !== 'excluded'}>
        <button
          class="nib-row press"
          type="button"
          data-flag={card.flag}
          disabled={!card.ids.length}
          onclick={() => opened(card.flag, card.ids)}
        >
          <span class="mark"><Glyph icon={card.icon} /></span>
          <span class="words">
            <span class="name">{flagName(card.flag)}</span>
            <span class="line">{card.line}</span>
          </span>
          {@render counted(card.ids.length)}
          {#if card.ids.length}<Glyph icon={ChevronRight} class="chevron" />{/if}
        </button>
      </div>
    {/each}
  </div>

  <h3 class="nib-section">{t('Dark web monitoring')}</h3>
  <div class="card dark">
    <div class="press is-static">
      <span class="mark"><Glyph icon={Radar} /></span>
      <span class="words">
        <span class="name">{t('Email addresses in breaches')}</span>
        <span class="line">{t('Needs a Have I Been Pwned API key.')}</span>
      </span>
    </div>
    {#if keyRead && key === ''}
      <form class="key" onsubmit={keptKey}>
        <input
          class="nib-field is-value"
          type="password"
          autocomplete="off"
          placeholder={t('API key')}
          aria-label={t('API key')}
          bind:value={typedKey}
        />
        <button class="nib-button" type="submit" disabled={!typedKey.trim()}>{t('Save')}</button>
      </form>
    {:else if key !== ''}
      <div class="emails">
        {#each emails as email (email)}
          {@const said = breaches[email]}
          <div class="nib-setting email">
            <span class="name">{email}</span>
            {#if typeof said === 'string'}
              <span class="text bad">{said}</span>
            {:else if said}
              <span class="text" class:bad={said.length > 0}>
                {said.length
                  ? plural(said.length, { one: '{count} breach', other: '{count} breaches' })
                  : t('No breaches')}
              </span>
            {/if}
          </div>
        {:else}
          <p class="quiet">{t('No email addresses in your logins')}</p>
        {/each}
        <div class="buttons">
          <button class="nib-button is-quiet" type="button" onclick={() => void forgetKey()}
            >{t('Remove key')}</button
          >
          <button
            class="nib-button"
            type="button"
            disabled={!emails.length}
            onclick={() => void lookUp()}>{t('Check')}</button
          >
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  .monitor {
    height: 100%;
    overflow-y: auto;
    padding: var(--space-4) var(--space-5) var(--space-6);
  }

  .head {
    margin-bottom: var(--space-4);
  }

  .title {
    margin: 0;
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
    gap: var(--space-3);
  }

  .card {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }

  .press {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: 0;
    color: var(--text);
  }

  .mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: calc(36px * var(--radius-third));
    background: var(--surface-3);
    color: var(--muted-strong);
  }

  .is-bad .mark {
    background: color-mix(in srgb, var(--callout-warning) 20%, transparent);
    color: var(--callout-warning);
  }

  .is-first.is-bad .mark {
    background: color-mix(in srgb, var(--danger) 18%, transparent);
    color: var(--danger);
  }

  .words {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .name {
    font-size: var(--text-row);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .line {
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .count {
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    font-variant-numeric: tabular-nums;
  }

  .clear {
    color: var(--success);
  }

  .press :global(.chevron) {
    color: var(--muted);
  }

  .check {
    margin: 0 var(--space-4) var(--space-3);
    align-self: flex-start;
  }

  .nib-section {
    margin: var(--space-5) 0 var(--space-2);
  }

  .dark {
    max-width: 40rem;
  }

  .key {
    display: flex;
    gap: var(--space-2);
    padding: 0 var(--space-4) var(--space-3);
  }

  .emails {
    display: flex;
    flex-direction: column;
    padding: 0 var(--space-4) var(--space-3);
  }

  .email .name {
    font-weight: var(--weight-row);
  }

  .bad {
    color: var(--danger);
    font-size: var(--text-sm);
  }

  .quiet {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
</style>
