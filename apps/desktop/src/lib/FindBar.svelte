<script lang="ts">
  import type { FindSpec } from '@orden/editor'
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import CaseSensitive from 'lucide/dist/esm/icons/case-sensitive.mjs'
  import ChevronDown from 'lucide/dist/esm/icons/chevron-down.mjs'
  import Regex from 'lucide/dist/esm/icons/regex.mjs'
  import WholeWord from 'lucide/dist/esm/icons/whole-word.mjs'
  import { t } from './i18n.svelte'
  import { dur } from './motion'
  import { SEARCH_MARK } from './panel-marks'
  import { arrive } from './slide'
  import { shortcuts } from './shortcuts.svelte'
  import Cross from './Cross.svelte'

  type FindFlags = Pick<FindSpec, 'caseSensitive' | 'regexp' | 'wholeWord'>

  const {
    query,
    count,
    current,
    capped = false,
    slow = false,
    flags,
    onflags,
    replacing = false,
    replacement = '',
    onreplacing,
    onreplacement,
    onreplace,
    onreplaceall,
    onstep,
    onselectall,
    onclose,
    onquery,
  }: {
    query: string
    count: number
    current: number
    capped?: boolean
    slow?: boolean
    flags?: FindFlags | undefined
    onflags?: ((flags: FindFlags) => void) | undefined
    replacing?: boolean
    replacement?: string
    onreplacing?: ((open: boolean) => void) | undefined
    onreplacement?: ((typed: string) => void) | undefined
    onreplace?: (() => void) | undefined
    onreplaceall?: (() => void) | undefined
    onstep: (by: number) => void
    onselectall?: (() => void) | undefined
    onclose: () => void
    onquery: (typed: string) => void
  } = $props()

  let field = $state<HTMLInputElement>()
  let replaceField = $state<HTMLInputElement>()

  const writable = $derived(!!onreplace)

  $effect(() => {
    const landing = replacing && replaceField ? replaceField : field
    landing?.focus()
    landing?.select()
  })

  const tally = $derived.by(() => {
    if (!query) return ''
    if (slow) return t('Pattern too slow to search')
    if (!count) return t('No matches')

    const of = capped ? `${count}+` : `${count}`
    return t('{at} of {count}', { at: current < 0 ? 1 : current + 1, count: of })
  })

  function flip(which: keyof FindFlags) {
    if (!flags || !onflags) return
    onflags({ ...flags, [which]: !flags[which] })
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onclose()
      return
    }

    if (event.key !== 'Enter') return
    event.preventDefault()
    if (event.altKey && onselectall) onselectall()
    else onstep(event.shiftKey ? -1 : 1)
  }
</script>

<div class="findbar" transition:arrive>
  <div class="line">
    <div class="box">
      <svg class="orden-field-mark mag" viewBox="0 0 13 13" aria-hidden="true"
        ><path d={SEARCH_MARK} /></svg
      >

      <input
        bind:this={field}
        class="orden-field query"
        class:flagged={!!flags}
        type="text"
        value={query}
        placeholder={t('Find')}
        aria-label={t('Find')}
        spellcheck="false"
        autocapitalize="off"
        autocorrect="off"
        oninput={(event: Event & { currentTarget: HTMLInputElement }) =>
          onquery(event.currentTarget.value)}
        onkeydown={onKeydown}
      />

      <span class="inside">
        {#if flags}
          <button
            class="flag"
            class:on={flags.caseSensitive}
            title={t('Match case')}
            aria-label={t('Match case')}
            aria-pressed={flags.caseSensitive}
            onclick={() => flip('caseSensitive')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {#each CaseSensitive as [tag, attrs], index (index)}
                <svelte:element this={tag} {...attrs} />
              {/each}
            </svg>
          </button>
          <button
            class="flag"
            class:on={flags.wholeWord}
            title={t('Whole word')}
            aria-label={t('Whole word')}
            aria-pressed={flags.wholeWord}
            onclick={() => flip('wholeWord')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {#each WholeWord as [tag, attrs], index (index)}
                <svelte:element this={tag} {...attrs} />
              {/each}
            </svg>
          </button>
          <button
            class="flag"
            class:on={flags.regexp}
            title={t('Regular expression')}
            aria-label={t('Regular expression')}
            aria-pressed={flags.regexp}
            onclick={() => flip('regexp')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {#each Regex as [tag, attrs], index (index)}
                <svelte:element this={tag} {...attrs} />
              {/each}
            </svg>
          </button>
        {/if}
      </span>
    </div>

    <span class="acts">
      {#if tally}
        <span class="tally" aria-live="polite">{tally}</span>
      {/if}

      <button
        class="orden-glyph act"
        title={shortcuts.tooltip(t('Previous'), 'edit.find-previous')}
        aria-label={t('Previous')}
        disabled={!count}
        onclick={() => onstep(-1)}
      >
        <svg viewBox="0 0 13 13" aria-hidden="true"><path d="M3.2 8.2 6.5 4.9l3.3 3.3" /></svg>
      </button>
      <button
        class="orden-glyph act"
        title={shortcuts.tooltip(t('Next'), 'edit.find-next')}
        aria-label={t('Next')}
        disabled={!count}
        onclick={() => onstep(1)}
      >
        <svg viewBox="0 0 13 13" aria-hidden="true"><path d="M3.2 4.9 6.5 8.2l3.3-3.3" /></svg>
      </button>

      {#if writable}
        <button
          class="orden-glyph act"
          class:on={replacing}
          title={shortcuts.tooltip(t('Replace'), 'edit.replace')}
          aria-label={t('Replace')}
          aria-expanded={replacing}
          onclick={() => onreplacing?.(!replacing)}
        >
          <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true">
            {#each ChevronDown as [tag, attrs], index (index)}
              <svelte:element this={tag} {...attrs} />
            {/each}
          </svg>
        </button>
      {/if}

      <button
        class="orden-glyph act shut"
        title={shortcuts.tooltip(t('Close'), 'fixed.escape')}
        aria-label={t('Close')}
        onclick={onclose}
      >
        <Cross />
      </button>
    </span>
  </div>

  {#if writable && replacing}
    <div class="line" transition:fly={{ y: -6, duration: dur(130), easing: cubicOut }}>
      <div class="box">
        <input
          bind:this={replaceField}
          class="orden-field"
          type="text"
          value={replacement}
          placeholder={t('Replace with')}
          aria-label={t('Replace with')}
          spellcheck="false"
          autocapitalize="off"
          autocorrect="off"
          oninput={(event: Event & { currentTarget: HTMLInputElement }) =>
            onreplacement?.(event.currentTarget.value)}
          onkeydown={(event: KeyboardEvent) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onclose()
            } else if (event.key === 'Enter') {
              event.preventDefault()
              if (event.shiftKey) onreplaceall?.()
              else onreplace?.()
            }
          }}
        />
      </div>

      <button class="apply" disabled={!count} onclick={() => onreplace?.()}>{t('Replace')}</button>
      <button class="apply" disabled={!count} onclick={() => onreplaceall?.()}
        >{t('Replace all')}</button
      >
    </div>
  {/if}
</div>

<style>
  .findbar {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }

  .line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .box {
    flex: 1 1 14rem;
  }

  .acts {
    flex: none;
    margin-inline-start: auto;
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .box {
    position: relative;
    min-width: 0;
  }

  .query {
    padding-inline-start: calc(var(--row-pad) + var(--icon-md) + var(--row-gap));
  }

  .query.flagged {
    padding-inline-end: calc((var(--row-height) - 6px) * 3 + var(--space-3));
  }

  .mag {
    position: absolute;
    inset-inline-start: var(--row-pad);
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
  }

  .inside {
    position: absolute;
    top: 50%;
    inset-inline-end: 3px;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 1px;
  }

  .tally {
    flex: none;
    padding: 0 var(--space-1);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
  }

  .flag {
    flex: none;
    width: calc(var(--row-height) - 6px);
    height: calc(var(--row-height) - 6px);
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .flag:hover {
      background: var(--surface-hover);
      color: var(--text);
    }
  }

  .flag:active {
    background: var(--surface-press);
  }

  .flag.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .flag:focus-visible {
    outline-offset: -1px;
  }

  .flag svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .act {
    border: 1px solid transparent;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .act.on {
    border-color: var(--accent-line);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .act:focus-visible {
    outline-offset: -1px;
  }

  .act svg {
    stroke-width: 1.6;
  }

  .act .chevron {
    width: var(--icon-sm);
    height: var(--icon-sm);
    stroke-width: 2.2;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .act.on .chevron {
    transform: rotate(180deg);
  }

  @media (hover: hover) {
    .shut:hover {
      color: var(--danger);
    }
  }

  .apply {
    flex: none;
    min-height: var(--row-height);
    padding: 0 var(--row-pad);
    border: 1px solid var(--line);
    border-radius: var(--radius-row);
    background: var(--surface-2);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    white-space: nowrap;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .apply:hover:not(:disabled) {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--accent-ink);
    }
  }

  .apply:active:not(:disabled) {
    background: var(--accent-press);
    border-color: var(--accent-press);
    color: var(--accent-ink);
  }

  .apply:disabled {
    color: var(--muted);
  }
</style>
