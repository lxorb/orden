<script lang="ts">
  import { fade, fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from './backstack.svelte'
  import { chorded } from './keys'
  import { opensAt, type Walk, walk } from './list-keys'
  import { overlays } from './overlays'
  import { viewport } from './viewport.svelte'
  import { dur } from './motion'

  interface Option {
    value: string
    label: string
    danger?: boolean
    note?: string
  }

  const {
    value,
    options,
    onchange,
    label,
    plain = false,
    disabled = false,
  }: {
    value: string
    options: Option[]
    onchange: (value: string) => void
    label?: string
    plain?: boolean
    disabled?: boolean
  } = $props()

  let open = $state(false)
  let walking = $state<Walk>({ cursor: null, typed: '', typedAt: 0 })
  let hovered = $state<number | null>(null)
  let above = $state(false)
  let host = $state<HTMLElement>()
  let list = $state<HTMLElement>()

  const current = $derived(options.find((one) => one.value === value))
  const id = `select-${Math.random().toString(36).slice(2, 8)}`

  const lit = $derived(hovered ?? walking.cursor)

  const ROW = 32
  const MOST = 280

  function show() {
    walking = opensAt(options.findIndex((one) => one.value === value))
    hovered = null

    if (host && !viewport.touch) {
      const box = host.getBoundingClientRect()
      const scroller = host.closest('[data-scrolls]') ?? document.documentElement
      const limit = scroller.getBoundingClientRect().bottom
      const needed = Math.min(MOST, options.length * ROW + 8) + 6
      above = box.bottom + needed > limit && box.top - needed > 0
    }

    open = true
  }

  function close() {
    open = false
  }

  function choose(next: string) {
    close()
    if (next !== value) onchange(next)
  }

  function onKey(event: KeyboardEvent) {
    if (chorded(event)) return

    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        show()
      }
      return
    }

    const step = walk(
      event.key,
      event.timeStamp,
      options.map((one) => one.label),
      walking,
    )

    if (step.took) event.preventDefault()
    walking = step.walk

    if (step.chose !== undefined) {
      const chosen = options[step.chose]
      if (chosen) choose(chosen.value)
      return
    }

    if (step.shut) {
      close()
      return
    }

    hovered = null
    if (walking.cursor !== null) {
      list?.children[walking.cursor]?.scrollIntoView({ block: 'nearest' })
    }
  }

  $effect(() => (open ? overlays.show(close, () => [host]) : undefined))
  $effect(() => closeOnBack(open && viewport.touch, close))
</script>

{#snippet named(option: Option)}
  <span class="text"
    >{option.label}{#if option.note}<span class="mark" title={option.note} aria-hidden="true"
        >*</span
      >{/if}</span
  >
  {#if option.note}<span class="nib-said">{option.note}</span>{/if}
{/snippet}

<div class="select" class:plain class:open bind:this={host}>
  <button
    type="button"
    class="trigger nib-field is-value"
    {disabled}
    role="combobox"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={label}
    aria-controls={open ? id : undefined}
    aria-activedescendant={open && walking.cursor !== null ? `${id}-${walking.cursor}` : undefined}
    onclick={() => (open ? close() : show())}
    onkeydown={onKey}
  >
    <span class="text">{current?.label ?? ''}</span>
    <svg class="chevron" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" /></svg>
  </button>

  {#if open && viewport.touch}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="nib-scrim scrim" transition:fade={{ duration: dur(130) }} onclick={close}></div>

    <div class="sheet" transition:fly={{ y: 32, duration: dur(220), easing: cubicOut }}>
      {#if label}<p class="heading">{label}</p>{/if}

      <ul {id} role="listbox" aria-label={label}>
        {#each options as option, index (option.value)}
          <li
            id="{id}-{index}"
            role="option"
            aria-selected={option.value === value}
            class:chosen={option.value === value}
          >
            <button type="button" class:danger={option.danger} onclick={() => choose(option.value)}>
              {@render named(option)}
              {#if option.value === value}
                <svg class="tick" viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 5" /></svg>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {:else if open}
    <ul
      {id}
      class="nib-layer list"
      class:above
      role="listbox"
      aria-label={label}
      bind:this={list}
      onmouseleave={() => (hovered = null)}
      transition:fly={{ y: above ? 4 : -4, duration: dur(120), easing: cubicOut }}
    >
      {#each options as option, index (option.value)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id="{id}-{index}"
          role="option"
          aria-selected={option.value === value}
          class:cursor={index === lit}
          class:chosen={option.value === value}
          class:danger={option.danger}
          onmouseenter={() => (hovered = index)}
          onclick={() => choose(option.value)}
        >
          {@render named(option)}
          {#if option.value === value}
            <svg class="tick" viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 5" /></svg>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .select {
    position: relative;
    display: block;
    width: 100%;
  }

  .plain {
    width: auto;
    min-width: 0;
  }

  .trigger {
    width: 100%;
    gap: var(--space-2);
  }

  .open .trigger {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .trigger .text,
  .list li .text,
  .sheet li button .text {
    unicode-bidi: isolate;
  }

  .trigger .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mark {
    margin-inline-start: 1px;
    color: var(--muted);
    font-size: 0.78em;
    line-height: 1;
    vertical-align: super;
  }

  .chevron {
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .open .chevron {
    transform: rotate(180deg);
  }

  .plain .trigger {
    justify-content: flex-end;
    padding: 6px 0 6px 6px;
    border: none;
    background: none;
    color: var(--muted-strong);
  }

  .plain .trigger .text {
    flex: 0 1 auto;
  }

  .plain.open .trigger {
    box-shadow: none;
    color: var(--text-strong);
  }

  .plain .trigger:focus-visible {
    color: var(--text-strong);
  }

  .list {
    position: absolute;
    top: calc(100% + var(--space-1));
    inset-inline-end: 0;
    min-width: 100%;
    max-height: 280px;
    margin: 0;
    padding: var(--space-1);
    list-style: none;
    overflow-y: auto;
    z-index: var(--z-popover);
  }

  .list.above {
    top: auto;
    bottom: calc(100% + var(--space-1));
  }

  .list li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 30px;
    padding: 5px 9px;
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    white-space: nowrap;
    cursor: default;
  }

  .list li,
  .sheet li {
    content-visibility: auto;
    contain-intrinsic-size: auto 30px;
  }

  .list li .text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .list li.cursor {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  .list li.chosen {
    color: var(--text-strong);
  }

  .list li.danger,
  .sheet li button.danger {
    color: var(--danger);
  }

  .list li.danger.cursor {
    background: var(--danger-soft);
  }

  .tick {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
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
    max-height: 70dvh;
    display: flex;
    flex-direction: column;
    padding-bottom: var(--touch-bottom);
    background: var(--surface);
    border-top: 1px solid var(--line-strong);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: var(--shadow-lg);
  }

  .heading {
    flex: none;
    margin: 0;
    padding: 14px 20px 8px;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted);
  }

  .sheet ul {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 4px 8px 8px;
    list-style: none;
    overflow-y: auto;
  }

  .sheet li button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: 0 var(--touch-pad);
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--touch-text);
    text-align: start;
    cursor: default;
  }

  .sheet li button:active {
    background: var(--surface-2);
  }

  .sheet li.chosen button {
    color: var(--text-strong);
  }

  .sheet li button .text {
    flex: 1;
    min-width: 0;
  }

  .sheet .tick {
    width: 18px;
    height: 18px;
  }

  :global([data-touch]) .trigger {
    min-height: var(--touch-target);
    font-size: var(--touch-text);
  }

  :global([data-touch]) .plain .trigger {
    min-height: var(--touch-target);
    font-size: var(--touch-text);
  }
</style>
