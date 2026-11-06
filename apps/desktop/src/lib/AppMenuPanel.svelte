<script lang="ts">
  import { fade, fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { DIVIDER, isSubmenu, type MenuGroup, type MenuRow, walkableRows } from './menu-item'
  import { closeOnBack } from './backstack.svelte'
  import { steppedKey } from './direction'
  import { overlays } from './overlays'
  import { pullsAway } from './sheet-pull'
  import { trap } from './trap'
  import { t } from './i18n.svelte'
  import { viewport } from './viewport.svelte'
  import { walked } from './walk'
  import { dur } from './motion'

  /* eslint-disable prefer-const -- `open` is bindable, and a $props() pattern cannot be split */
  let {
    open = $bindable(false),
    groups,
  }: {
    open?: boolean
    groups: MenuGroup[]
  } = $props()
  /* eslint-enable prefer-const */

  let current = $state('file')
  let into = $state<string | null>(null)

  let at = $state<number | null>(null)
  let surface = $state<HTMLElement>()

  const BACK = -1

  function choose(id: string) {
    current = id
    into = null
    at = null
  }

  const shown = $derived(groups.find((one) => one.id === current))

  const rows = $derived.by((): MenuRow[] => {
    const all = shown?.rows ?? []
    if (into === null) return all

    const found = all.find((row) => isSubmenu(row) && row.label === into)
    return found && isSubmenu(found) ? found.rows : all
  })

  const walkable = $derived(into === null ? walkableRows(rows) : [BACK, ...walkableRows(rows)])

  const cursor = $derived(at === null ? null : (walkable[at] ?? null))

  $effect(() => {
    if (open) surface?.focus()
  })

  function enter(label: string, standing = false) {
    into = label
    at = standing ? Math.min(1, walkable.length - 1) : null
  }

  function leave() {
    const label = into
    into = null

    const led = rows.findIndex((row) => row !== DIVIDER && isSubmenu(row) && row.label === label)
    const found = walkable.indexOf(led)
    at = found < 0 ? null : found
  }

  function sideways(direction: number) {
    const index = groups.findIndex((one) => one.id === current)
    const next = groups[(index + direction + groups.length) % groups.length]
    if (next) choose(next.id)
  }

  function activate() {
    if (cursor === null) return
    if (cursor === BACK) {
      leave()
      return
    }

    const row = rows[cursor]
    if (row === undefined || row === DIVIDER) return
    if (isSubmenu(row)) {
      enter(row.label, true)
      return
    }

    open = false
    row.run()
  }

  function onKey(event: KeyboardEvent) {
    const moved = walked(event.key, at, walkable.length, true)
    if (moved !== null) {
      event.preventDefault()
      at = moved
      return
    }

    const row = cursor === null || cursor === BACK ? null : rows[cursor]

    switch (steppedKey(event.key)) {
      case 'Enter':
      case ' ':
        event.preventDefault()
        activate()
        return
      case 'ArrowRight':
        event.preventDefault()
        if (row && isSubmenu(row)) enter(row.label, true)
        else sideways(1)
        return
      case 'ArrowLeft':
        event.preventDefault()
        if (into !== null) leave()
        else sideways(-1)
        return
      case 'Escape':
        if (into === null) return
        event.preventDefault()
        event.stopPropagation()
        leave()
        return
      default:
        return
    }
  }

  function arrive(node: Element) {
    if (viewport.touch) return fly(node, { y: 40, duration: dur(220), easing: cubicOut })

    return {
      duration: dur(220),
      easing: cubicOut,
      css: (t: number) =>
        `opacity: ${t}; transform: translate(calc(var(--dir) * ${(t - 1) * 6}px), ${(t - 1) * 6}px) scale(${0.96 + 0.04 * t}); transform-origin: top var(--dir-start)`,
    }
  }

  $effect(() =>
    open
      ? overlays.show(
          () => (open = false),
          () => [surface, ...document.querySelectorAll('[data-opens="app-menu"]')],
        )
      : undefined,
  )
  $effect(() => closeOnBack(open, () => (open = false)))

  $effect.pre(() => {
    current = groups[0]?.id ?? 'file'
    into = null
    at = null
  })
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim scrim is-clear"
    transition:fade={{ duration: dur(130) }}
    onclick={() => (open = false)}
  ></div>

  <div
    bind:this={surface}
    class="nib-layer nib-host menu"
    class:phone={viewport.touch}
    transition:arrive
    use:trap
    use:pullsAway={viewport.touch ? () => (open = false) : null}
    role="menu"
    tabindex="-1"
    aria-label={t('Menu')}
    aria-activedescendant={cursor === null ? undefined : `nib-menu-${cursor}`}
    onkeydown={onKey}
  >
    {#if viewport.touch}
      <div class="grip" aria-hidden="true"></div>
    {/if}

    <ul class="groups">
      {#each groups as group (group.id)}
        <li>
          <button
            class="nib-row"
            class:is-on={group.id === current}
            onmouseenter={() => choose(group.id)}
            onclick={() => choose(group.id)}
          >
            {group.label}
          </button>
        </li>
      {/each}
    </ul>

    <ul class="rows">
      {#if into !== null}
        <li>
          <button
            id="nib-menu-{BACK}"
            class="nib-row row back"
            class:selected={cursor === BACK}
            role="menuitem"
            onmouseenter={() => (at = walkable.indexOf(BACK))}
            onclick={leave}
          >
            <span class="tick" aria-hidden="true">
              <svg class="nib-mirror" viewBox="0 0 12 12"><path d="M7.5 2.5 4 6l3.5 3.5" /></svg>
            </span>
            <span class="nib-row-label">{into}</span>
          </button>
        </li>
        <li class="split"></li>
      {/if}

      {#each rows as row, index (index)}
        {@const leads = row !== DIVIDER && isSubmenu(row) ? row : null}
        {@const action = row !== DIVIDER && !isSubmenu(row) ? row : null}

        {#if leads}
          <li>
            <button
              id="nib-menu-{index}"
              class="nib-row row"
              class:selected={cursor === index}
              role="menuitem"
              disabled={leads.disabled}
              onmouseenter={() => (at = walkable.indexOf(index))}
              onclick={() => enter(leads.label)}
            >
              <span class="tick"></span>
              <span class="nib-row-label">{leads.label}</span>
              <span class="more" aria-hidden="true">
                <svg class="nib-mirror" viewBox="0 0 12 12"><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg>
              </span>
            </button>
          </li>
        {:else if action}
          <li>
            <button
              id="nib-menu-{index}"
              class="nib-row row"
              class:selected={cursor === index}
              role="menuitem"
              disabled={action.disabled}
              onmouseenter={() => (at = walkable.indexOf(index))}
              onclick={() => {
                open = false
                action.run()
              }}
            >
              <span class="tick">{action.checked ? '✓' : ''}</span>
              <span class="nib-row-label">{action.label}</span>
              {#if action.hint}<span class="nib-row-meta hint">{action.hint}</span>{/if}
            </button>
          </li>
        {:else}
          <li class="split"></li>
        {/if}
      {/each}
    </ul>
  </div>
{/if}

<style>
  .scrim {
    --scrim-z: var(--z-menu);
    --scrim-ink: 55%;
    --scrim-blur: 2px;
  }

  .menu {
    position: fixed;
    top: calc(var(--titlebar-height) + var(--space-1));
    inset-inline-start: var(--space-2);
    z-index: var(--z-menu);
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    display: flex;
    max-height: 78vh;
    overflow: hidden;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: var(--space-2);
    overflow-y: auto;
  }

  .groups {
    flex: none;
    width: 8.5rem;
    border-inline-end: 1px solid var(--line);
  }

  .rows {
    min-width: 15rem;
  }

  button:not(.nib-glyph) {
    color: var(--text);
  }

  .row.selected {
    background: var(--surface-hover);
    color: var(--text-strong);
  }

  button:not(.nib-glyph):disabled {
    color: var(--muted);
  }

  .tick {
    width: 1em;
    flex: none;
    color: var(--accent);
  }

  .more,
  .back .tick {
    flex: none;
    display: grid;
    place-items: center;
    color: var(--muted);
  }

  .more svg,
  .back .tick svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .back .nib-row-label {
    color: var(--muted-strong);
  }

  .hint {
    font-family: var(--font-mono);
  }

  .split {
    height: 1px;
    margin: var(--space-2) 6px;
    background: var(--line);
  }

  :global([data-touch]) .scrim.is-clear {
    background: color-mix(in srgb, var(--bg) var(--scrim-ink), transparent);
    -webkit-backdrop-filter: blur(var(--scrim-blur));
    backdrop-filter: blur(var(--scrim-blur));
  }

  :global([data-touch]) .menu.phone {
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    flex-direction: column;
    max-height: 72dvh;
    padding-bottom: var(--touch-bottom);
    border: none;
    border-top: 1px solid var(--line-strong);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface);
  }

  :global([data-touch]) .grip {
    flex: none;
    width: 36px;
    height: 4px;
    margin: 8px auto 2px;
    border-radius: 2px;
    background: var(--line-strong);
  }

  :global([data-touch]) .phone .groups {
    flex: none;
    width: auto;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-4) var(--space-3);
    border-inline-end: none;
    border-bottom: 1px solid var(--line);
    overflow: visible;
  }

  :global([data-touch]) .phone .groups button {
    width: auto;
    min-height: var(--touch-target);
    padding: 0 var(--touch-pad);
    border-radius: 99px;
    background: var(--surface-2);
    color: var(--muted-strong);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
  }

  :global([data-touch]) .phone .groups button.is-on {
    background: var(--surface-selected);
    color: var(--active-file-text-color);
  }

  :global([data-touch]) .phone .rows {
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 6px var(--space-2) var(--space-2);
    overflow-y: auto;
  }

  :global([data-touch]) .phone .tick {
    order: 2;
    width: auto;
    margin-inline-start: auto;
  }

  :global([data-touch]) .phone .back .tick {
    order: 0;
    width: 1em;
    margin-inline-start: 0;
  }

  :global([data-touch]) .phone .hint {
    display: none;
  }

  :global([data-touch]) .phone .split {
    margin: var(--space-1) var(--space-3);
  }
</style>
