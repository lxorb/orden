<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack, hang, overlays, viewport } from '../../ui-kit/src/api'
  import { dur, fade, fly } from '../../platform/src/api'
  import Calendar from './Calendar.svelte'
  import { dateWords, readDate, todayIso } from './calendar'

  const {
    value,
    onchange,
    label,
    placeholder = 'No date',
    clearable = true,
    disabled = false,
    autofocus = false,
    bare = false,
  }: {
    value: string
    onchange: (iso: string) => void
    label: string
    placeholder?: string
    clearable?: boolean
    disabled?: boolean
    autofocus?: boolean
    bare?: boolean
  } = $props()
  let open = $state(false)
  let host = $state<HTMLElement>()
  let field = $state<HTMLInputElement>()
  let opener = $state<HTMLButtonElement>()
  let pop = $state<HTMLElement>()
  const shown = $derived(value ? dateWords(value) : '')
  const popId = `date-${Math.random().toString(36).slice(2, 8)}`
  function close(refocus = false) {
    open = false
    if (refocus) field?.focus()
  }
  function choose(iso: string) {
    close(true)
    if (iso !== value) onchange(iso)
  }
  function settle(typed: HTMLInputElement) {
    const words = typed.value.trim()
    const iso = words === '' ? (clearable ? '' : value) : readDate(words)
    typed.value = shown
    if (iso === null) {
      typed.setAttribute('aria-invalid', 'true')
      return
    }
    typed.removeAttribute('aria-invalid')
    if (iso !== value) onchange(iso)
  }
  function onFieldKey(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if (event.isComposing) return
    if (event.key === 'Enter') {
      settle(event.currentTarget)
    } else if (event.key === 'ArrowDown' && !open) {
      event.preventDefault()
      open = true
    }
  }
  function onPopKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close(true)
  }
  function focusOnMount(node: HTMLElement) {
    if (autofocus) node.focus()
  }
  $effect(() =>
    open
      ? overlays.show(
          () => close(),
          () => [host, pop],
          opener ?? null,
        )
      : undefined,
  )
  $effect(() => closeOnBack(open && viewport.touch, () => close()))
</script>

{#snippet picker()}
  <Calendar {value} {label} autofocus onpick={choose} />
  <div class="foot">
    <button type="button" class="orden-chip" onclick={() => choose(todayIso())}>Today</button>
    {#if clearable && value}
      <button type="button" class="orden-chip" onclick={() => choose('')}>Clear</button>
    {/if}
  </div>
{/snippet}

<div class="date" bind:this={host}>
  <div class={bare ? 'bare' : 'orden-field is-value'} class:open>
    <input
      bind:this={field}
      type="text"
      autocomplete="off"
      spellcheck="false"
      aria-label={label}
      {placeholder}
      {disabled}
      value={shown}
      use:focusOnMount
      onchange={(event) => settle(event.currentTarget)}
      onkeydown={onFieldKey}
    />
    <button
      bind:this={opener}
      type="button"
      class="orden-glyph"
      aria-label="Choose a date"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? popId : undefined}
      {disabled}
      onclick={() => (open = !open)}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true"
        ><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></svg
      >
    </button>
  </div>

  {#if open && viewport.touch}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="orden-scrim scrim" transition:fade={{ duration: dur(130) }} onclick={() => close()}></div>
    <div
      id={popId}
      class="sheet"
      role="dialog"
      aria-label={label}
      tabindex="-1"
      bind:this={pop}
      onkeydown={onPopKey}
      transition:fly={{ y: 32, duration: dur(220), easing: cubicOut }}
    >
      <p class="heading">{label}</p>
      {@render picker()}
    </div>
  {:else if open}
    <div
      id={popId}
      class="orden-layer pop"
      role="dialog"
      aria-label={label}
      tabindex="-1"
      bind:this={pop}
      use:hang={{ side: 'below', gap: 4, from: host ?? null }}
      onkeydown={onPopKey}
      transition:fly={{ y: -4, duration: dur(120), easing: cubicOut }}
    >
      {@render picker()}
    </div>
  {/if}
</div>

<style>
  .date {
    position: relative;
    display: block;
    width: 100%;
    min-width: 0;
  }
  input {
    font-variant-numeric: tabular-nums;
  }
  .open:not(.bare) {
    border-color: var(--accent);
  }
  .bare {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .bare input {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
  }
  .bare .orden-glyph {
    width: 22px;
    height: 22px;
  }
  .orden-glyph > svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .pop {
    z-index: var(--z-menu);
  }
  .foot {
    display: flex;
    gap: var(--space-2);
    padding: 0 var(--space-2) var(--space-2);
  }
  .scrim {
    --scrim-z: var(--z-menu);
    --scrim-ink: 55%;
    --scrim-blur: 2px;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: var(--z-menu);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-bottom: var(--touch-bottom);
    background: var(--surface);
    border-top: 1px solid var(--line-strong);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: var(--shadow-lg);
  }
  .heading {
    align-self: stretch;
    margin: 0;
    padding: 14px 20px 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted);
  }
</style>
