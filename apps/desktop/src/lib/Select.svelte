<script lang="ts">
  /** A dropdown that is ours all the way down. The native `<select>` closes
   *  the way it is told to but opens the way the operating system likes, with
   *  a highlight in whatever blue that is. This one opens a list in the
   *  theme's colours: under the trigger on a desktop, as a sheet from the
   *  bottom on a phone, where a list the size of a finger is what a picker
   *  looks like anyway. */
  import { fade, fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from './backstack.svelte'
  import { viewport } from './viewport.svelte'

  interface Option {
    value: string
    label: string
  }

  let {
    value,
    options,
    onchange,
    label,
    plain = false,
  }: {
    value: string
    options: Option[]
    onchange: (value: string) => void
    /** Names the control for a screen reader, and heads the sheet on a phone. */
    label?: string
    /** Borderless, with the value at the right: how a settings row shows one. */
    plain?: boolean
  } = $props()

  let open = $state(false)
  /** The row the keyboard is on while the list is open. */
  let cursor = $state(0)
  /** The list opens upward when there is no room beneath the trigger. */
  let above = $state(false)
  let host = $state<HTMLElement>()
  let list = $state<HTMLElement>()

  const current = $derived(options.find((one) => one.value === value))
  const id = `select-${Math.random().toString(36).slice(2, 8)}`

  /** Letters typed in a row jump to the first option that starts with them. */
  let typed = ''
  let typedAt = 0

  /** Room the list needs beneath the trigger, before it is drawn. */
  const ROW = 32
  const MOST = 280

  function show() {
    cursor = Math.max(
      0,
      options.findIndex((one) => one.value === value),
    )

    if (host && !viewport.phone) {
      // Measured against the nearest thing that scrolls, which is what would
      // clip a list poking out of its bottom. Scroll containers say so with
      // `data-scrolls`; without one, the window is the limit.
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
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        show()
      }
      return
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        cursor = (cursor + 1) % options.length
        break
      case 'ArrowUp':
        event.preventDefault()
        cursor = (cursor - 1 + options.length) % options.length
        break
      case 'Home':
        event.preventDefault()
        cursor = 0
        break
      case 'End':
        event.preventDefault()
        cursor = options.length - 1
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        choose(options[cursor].value)
        break
      case 'Escape':
        event.preventDefault()
        close()
        break
      case 'Tab':
        close()
        break
      default:
        if (event.key.length !== 1) return
        if (event.timeStamp - typedAt > 600) typed = ''
        typed += event.key.toLowerCase()
        typedAt = event.timeStamp

        const found = options.findIndex((one) => one.label.toLowerCase().startsWith(typed))
        if (found >= 0) cursor = found
    }

    list?.children[cursor]?.scrollIntoView({ block: 'nearest' })
  }

  // Tapping anywhere else closes it, the way a menu closes.
  function outside(event: PointerEvent) {
    if (open && host && !host.contains(event.target as Node)) close()
  }

  // Back closes the sheet before it leaves the app.
  $effect(() => closeOnBack(open && viewport.phone, close))
</script>

<svelte:window onpointerdown={outside} />

<div class="select" class:plain class:open bind:this={host}>
  <!-- A select-only combobox, in ARIA's terms: a button that opens a listbox
       and keeps the focus while the arrow keys walk the list. -->
  <button
    type="button"
    class="trigger"
    role="combobox"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={label}
    aria-controls={open ? id : undefined}
    aria-activedescendant={open ? `${id}-${cursor}` : undefined}
    onclick={() => (open ? close() : show())}
    onkeydown={onKey}
  >
    <span class="text">{current?.label ?? ''}</span>
    <svg class="chevron" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" /></svg>
  </button>

  {#if open && viewport.phone}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="scrim" transition:fade={{ duration: 130 }} onclick={close}></div>

    <div class="sheet" transition:fly={{ y: 32, duration: 220, easing: cubicOut }}>
      {#if label}<p class="heading">{label}</p>{/if}

      <ul {id} role="listbox" aria-label={label}>
        {#each options as option, index (option.value)}
          <li
            id="{id}-{index}"
            role="option"
            aria-selected={option.value === value}
            class:chosen={option.value === value}
          >
            <button type="button" onclick={() => choose(option.value)}>
              <span class="text">{option.label}</span>
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
      class="list"
      class:above
      role="listbox"
      aria-label={label}
      bind:this={list}
      transition:fly={{ y: above ? 4 : -4, duration: 120, easing: cubicOut }}
    >
      {#each options as option, index (option.value)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id="{id}-{index}"
          role="option"
          aria-selected={option.value === value}
          class:cursor={index === cursor}
          class:chosen={option.value === value}
          onmouseenter={() => (cursor = index)}
          onclick={() => choose(option.value)}
        >
          <span class="text">{option.label}</span>
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

  /* The closed control reads like every other input in the app. */
  .trigger {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 8px 10px 8px 11px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: 1.4;
    text-align: left;
    cursor: default;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .trigger:hover {
    border-color: var(--muted);
  }

  .trigger:focus-visible,
  .open .trigger {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
    outline: none;
  }

  .trigger:disabled {
    opacity: 0.55;
  }

  .trigger .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chevron {
    flex: none;
    width: 10px;
    height: 10px;
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

  /* In a settings row: no box of its own, the value at the right edge, like
     the value of anything else in the list. */
  .plain .trigger {
    justify-content: flex-end;
    padding: 6px 0 6px 6px;
    border: none;
    background: none;
    color: var(--muted-strong);
  }

  .plain .trigger .text {
    flex: none;
    max-width: 100%;
  }

  .plain .trigger:focus-visible,
  .plain.open .trigger {
    box-shadow: none;
    color: var(--text-strong);
  }

  /* ── The list, on a desktop ────────────────────────────────────── */

  .list {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 100%;
    max-height: 280px;
    margin: 0;
    padding: 4px;
    list-style: none;
    overflow-y: auto;
    z-index: 5;
    background: var(--surface-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }

  .list.above {
    top: auto;
    bottom: calc(100% + 4px);
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

  .list li .text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The row under the pointer or the arrow keys, in the theme's own accent
     and not the platform's. */
  .list li.cursor {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  .list li.chosen {
    color: var(--text-strong);
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

  /* ── The sheet, on a phone ─────────────────────────────────────── */

  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(2px);
  }

  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 61;
    max-height: 70dvh;
    display: flex;
    flex-direction: column;
    padding-bottom: env(safe-area-inset-bottom);
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
    font-weight: 600;
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
    gap: var(--space-3);
    min-height: 48px;
    padding: 10px 12px;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 15px;
    text-align: left;
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

  @media (max-width: 720px) {
    .trigger {
      min-height: 46px;
      /* Sixteen pixels is where iOS stops zooming into a control on focus. */
      font-size: 16px;
    }

    .plain .trigger {
      min-height: 0;
      font-size: 15px;
    }
  }
</style>
