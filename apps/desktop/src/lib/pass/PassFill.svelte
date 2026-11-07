<script lang="ts">
  import { onMount } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from '../i18n.svelte'
  import { dur } from '../motion'
  import { overlays } from '../overlays'
  import { takeKeyboard } from '../take-keyboard'
  import { isDesktop } from '../tauri'
  import { autofill } from './autofill'
  import type { FillChoice, PassBubble } from './fill-bubble'
  import { roleWord } from './fill-words'
  import { openPass } from './open'
  import { pass } from './store.svelte'

  const { bubble }: { bubble: PassBubble | null } = $props()

  let card = $state<HTMLElement>()

  const label = $derived.by(() => {
    if (!bubble) return ''
    switch (bubble.kind) {
      case 'choose':
        return t('Fill from Pass')
      case 'unlock':
        return t('Pass is locked')
      case 'save':
        return bubble.update ? t('Update password?') : t('Save login?')
      case 'signing':
        return t('Signing in')
    }
  })

  $effect(() =>
    overlays.show(() => {
      if (bubble) autofill.dismiss(bubble.tab)
    }),
  )

  $effect(() => {
    if (bubble?.kind === 'unlock' && pass.state === 'open') autofill.reoffer(bubble.tab)
  })

  onMount(() => {
    card?.focus({ preventScroll: true })
    if (isDesktop && !document.hasFocus()) void takeKeyboard()
  })

  function opened(tab: string) {
    autofill.dismiss(tab)
    openPass()
  }
</script>

{#snippet choices(tab: string, title: string, list: FillChoice[])}
  {#if list.length > 0}
    <p class="group">{title}</p>
    <div class="list">
      {#each list as one (one.id)}
        <button
          class="choice orden-button is-quiet"
          data-pass-choice={one.id}
          onclick={() => void autofill.choose(tab, one.id)}
        >
          <span class="title">{one.title || t('Untitled')}</span>
          {#if one.subtitle}<span class="subtitle">{one.subtitle}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
{/snippet}

<div
  class="fill orden-bubble is-pressable orden-host"
  role="dialog"
  aria-label={label}
  tabindex="-1"
  data-pass-fill={bubble?.kind}
  bind:this={card}
  transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}
>
  {#if bubble?.kind === 'choose'}
    <p class="what"><strong>{bubble.site}</strong></p>
    {@render choices(bubble.tab, t('Logins'), bubble.logins)}
    {#if bubble.fields.length > 0}
      <p class="which" data-pass-fields>
        {t('Fills {fields}', { fields: bubble.fields.map(roleWord).join(', ') })}
      </p>
    {/if}
    {@render choices(bubble.tab, t('Cards'), bubble.cards)}
    {@render choices(bubble.tab, t('Identities'), bubble.identities)}
    {#if bubble.logins.length + bubble.cards.length + bubble.identities.length === 0}
      <p class="which">{t('Nothing in Pass for this site yet.')}</p>
    {/if}
    <div class="rows">
      <button class="orden-button is-quiet" onclick={() => opened(bubble.tab)}>
        {t('Open Pass')}
      </button>
      {#if bubble.alias}
        <button class="orden-button is-quiet" onclick={() => void autofill.alias(bubble.tab)}>
          {t('Use an alias')}
        </button>
      {/if}
      {#if bubble.generate}
        <button class="orden-button" onclick={() => void autofill.generate(bubble.tab)}>
          {t('Generate password')}
        </button>
      {/if}
    </div>
  {:else if bubble?.kind === 'unlock'}
    <p class="what">{t('Pass is locked')}</p>
    <p class="which">{t('Unlock Pass to fill this page.')}</p>
    <div class="rows">
      <button class="orden-button" onclick={() => opened(bubble.tab)}>{t('Unlock Pass')}</button>
    </div>
  {:else if bubble?.kind === 'save'}
    <p class="what">
      <strong>{bubble.update ? t('Update password?') : t('Save login?')}</strong>
    </p>
    <p class="which">
      {bubble.username
        ? t('{name} on {site}', { name: bubble.username, site: bubble.site })
        : bubble.site}
    </p>
    <div class="rows">
      {#if !bubble.update}
        <button class="orden-button is-quiet" onclick={() => autofill.never(bubble.tab)}>
          {t('Never for this site')}
        </button>
      {/if}
      <button class="orden-button is-quiet" onclick={() => autofill.dismiss(bubble.tab)}>
        {t('Not now')}
      </button>
      <button class="orden-button" onclick={() => void autofill.save(bubble.tab)}>
        {bubble.update ? t('Update') : t('Save')}
      </button>
    </div>
  {:else if bubble?.kind === 'signing'}
    <p class="what">{t('Signing in as {name}…', { name: bubble.name })}</p>
    <div class="rows">
      <button class="orden-button" onclick={() => autofill.stop(bubble.tab)}>{t('Stop')}</button>
    </div>
  {/if}
</div>

<style>
  .fill {
    position: absolute;
    top: 100%;
    left: var(--space-2);
    z-index: var(--z-float);
    width: min(22rem, calc(100% - var(--space-4)));
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .what {
    margin: 0;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .which,
  .group {
    margin: 0;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .group {
    margin-top: var(--space-1);
  }

  .list {
    display: flex;
    flex-direction: column;
    max-height: 16rem;
    overflow-y: auto;
  }

  .choice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    text-align: start;
  }

  .title {
    color: var(--text-strong);
  }

  .subtitle {
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .rows {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
</style>
